// @ts-check
import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { makeNotifierKit, observeIteration } from '@agoric/notifier';
import { amountMath } from '@agoric/ertp';
import { isPromise } from '@agoric/promise-kit';

import '@agoric/ertp/exported';
import '@agoric/notifier/exported';

/**
 * @template T
 * @typedef {import('@agoric/eventual-send').EOnly<T>} EOnly An object roughly
 * of type T that is only allowed to be consumed via eventual-send.  This allows
 * the object to return Promises wherever it wants to, even when T demands a
 * synchronous return value.
 */

/**
 * @typedef {Object} VirtualPurseController The object that determines the
 * remote behaviour of a virtual purse.
 * @property {(amount: Amount) => Promise<void>} pushAmount Tell the controller
 * to send an amount from "us" to the "other side".  This should resolve on
 * success and reject on failure.  IT IS IMPORTANT NEVER TO FAIL in normal
 * operation.  That will irrecoverably lose assets.
 * @property {(amount: Amount) => Promise<void>} pullAmount Tell the controller
 * to send an amount from the "other side" to "us".  This should resolve on
 * success and reject on failure.  We can still recover assets from failure to
 * pull.
 * @property {(brand: Brand) => AsyncIterable<Amount>} getBalances Return the
 * current balance iterable for a given brand.
 */

/**
 * @param {ERef<VirtualPurseController>} vpc the controller that represents the
 * "other side" of this purse.
 * @param {{ issuer: ERef<Issuer>, brand: ERef<Brand>, mint?: ERef<Mint> }} kit
 * the contents of the issuer kit for "us".
 *
 * If the mint is not specified, then the virtual purse will escrow local assets
 * instead of minting/burning them.  That is a better option in general, but
 * escrow doesn't support the case where the "other side" is also minting
 * assets... our escrow purse may not have enough assets in it to redeem the
 * ones that are sent from the "other side".
 * @returns {EOnly<Purse>} This is not just a Purse because it plays
 * fast-and-loose with the synchronous Purse interface.  So, the consumer of
 * this result must only interact with the virtual purse via eventual-send (to
 * conceal the methods that are returning promises instead of synchronously).
 */
function makeVirtualPurse(vpc, kit) {
  const { brand, issuer, mint } = kit;

  /** @type {(amt: Amount) => Promise<Payment>} */
  let redeem;
  /** @type {(pmt: Payment, optAmount: Amount | undefined) => Promise<Amount>} */
  let retain;

  if (mint) {
    retain = (payment, optAmount) => E(issuer).burn(payment, optAmount);
    redeem = amount => E(mint).mintPayment(amount);
  } else {
    // If we can't mint, then we need to escrow.
    const escrowPurse = E(issuer).makeEmptyPurse();
    retain = (payment, optAmount) => E(escrowPurse).deposit(payment, optAmount);
    redeem = amount => E(escrowPurse).withdraw(amount);
  }

  /** @type {NotifierRecord<Amount>} */
  const {
    notifier: balanceNotifier,
    updater: balanceUpdater,
  } = makeNotifierKit();

  /** @type {ERef<Amount>} */
  let lastBalance = E.when(brand, b => {
    const amt = amountMath.makeEmpty(b);
    balanceUpdater.updateState(amt);
    return amt;
  });

  // Robustly observe the balance.
  const fail = reason => {
    balanceUpdater.fail(reason);
    const rej = Promise.reject(reason);
    rej.catch(_ => {});
    lastBalance = rej;
  };
  observeIteration(
    // Get the brand's actual unwrapped identity.
    E.when(brand, b => E(vpc).getBalances(b)),
    {
      fail,
      updateState(nonFinalValue) {
        balanceUpdater.updateState(nonFinalValue);
        lastBalance = nonFinalValue;
      },
      finish(completion) {
        balanceUpdater.finish(completion);
        lastBalance = completion;
      },
      // Propagate a failed balance properly if the iteration observer fails.
    },
  ).catch(fail);

  /** @type {EOnly<DepositFacet>} */
  const depositFacet = {
    async receive(payment, optAmount = undefined) {
      if (isPromise(payment)) {
        throw TypeError(
          `deposit does not accept promises as first argument. Instead of passing the promise (deposit(paymentPromise)), consider unwrapping the promise first: paymentPromise.then(actualPayment => deposit(actualPayment))`,
        );
      }
      // FIXME: There is no potential recovery protocol for failed deposit,
      // since retaining the payment consumes it, and there's no way to send a
      // new payment back to the virtual purse holder.
      const amt = await retain(payment, optAmount);
      // The push must always succeed.
      return E(vpc)
        .pushAmount(amt)
        .then(_ => amt);
    },
  };
  Far('Virtual Deposit Facet', depositFacet);

  /** @type {EOnly<Purse>} */
  const purse = {
    deposit: depositFacet.receive,
    getAllegedBrand() {
      return brand;
    },
    getCurrentAmount() {
      return lastBalance;
    },
    getCurrentAmountNotifier() {
      return balanceNotifier;
    },
    getDepositFacet() {
      return depositFacet;
    },
    async withdraw(amount) {
      await E(vpc).pullAmount(amount);
      // Amount has been successfully received from the other side.
      // Try to redeem the amount.
      const pmt = await redeem(amount).catch(async e => {
        // We can recover from failed redemptions... just send back what we
        // received.
        await E(vpc).pushAmount(amount);
        throw e;
      });
      return pmt;
    },
  };
  return Far('Virtual Purse', purse);
}
harden(makeVirtualPurse);

export { makeVirtualPurse };
