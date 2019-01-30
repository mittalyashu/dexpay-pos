import Web3 from 'web3';
import BigNumber from 'bignumber.js';
import CONF from '../config';

export const ethToWei = v => {
  const wei = new BigNumber(v).multipliedBy(1000000000000000000);
  return wei;
};

export default class WatcherTx {
  static NETWORKS = {
    XDAI: 'XDAI',
    ROPSTEN: 'ROPSTEN'
  };

  static STATES = {
    PENDING: 'PENDING',
    DETECTED: 'DETECTED',
    CONFIRMED: 'CONFIRMED'
  };

  constructor(network) {
    this.selectedNetwork = network;
    this.pollingOn = true;
    this.lastBlockChecked = null;
  }

  getWeb3ws(url = 'wss://ropsten.infura.io/_ws') {
    return new Web3(new Web3.providers.WebsocketProvider(url));
  }

  getWeb3Http() {
    switch (this.selectedNetwork) {
      case WatcherTx.NETWORKS.XDAI:
        return new Web3('https://dai.poa.network');
      case WatcherTx.NETWORKS.ROPSTEN:
        return new Web3('https://ropsten.infura.io/Q1GYXZMXNXfKuURbwBWB');
      default:
        return new Web3('https://ropsten.infura.io/Q1GYXZMXNXfKuURbwBWB');
    }
  }

  validate(trx, total, recipient) {
    const toValid = trx.to !== null;
    if (!toValid) return false;

    const walletToValid = trx.to.toLowerCase() === recipient.toLowerCase();
    const amountValid = ethToWei(total).isEqualTo(trx.value);

    return toValid && amountValid && walletToValid;
  }

  async xdaiTransfer(recipient, total, cb) {
    // Get block number
    const web3 = this.getWeb3Http();
    const currentBlock = await web3.eth.getBlockNumber();

    console.log(currentBlock, this.pollingOn);

    if (currentBlock > this.lastBlockChecked) {
      const block = await web3.eth.getBlock(currentBlock);
      this.lastBlockChecked = currentBlock;

      if (block.transactions.length) {
        block.transactions.forEach(async txHash => {
          const trx = await web3.eth.getTransaction(txHash);
          console.log('trx', trx);
          const valid = this.validate(trx, total, recipient);

          if (valid) {
            this.pollingOn = false;

            if (CONF.ENABLE_LOGS) {
              console.log('trx', trx);
              console.log(
                `Found incoming XDAI transaction from ${trx.from} to ${trx.to}`
              );
              console.log(`Transaction value is: ${trx.value}`);
              console.log(`Transaction hash is: ${txHash}\n`);
            }

            // CB for detected transactions
            cb({
              state: WatcherTx.STATES.DETECTED,
              tx: trx,
              txHash
            });

            // Initiate transaction confirmation
            this.confirmTransaction(txHash, CONF.confirmationNeeded, cb);
          }
        }, this);
      }
    }

    if (this.pollingOn) {
      setTimeout(() => this.xdaiTransfer(recipient, total, cb), 5000);
    }
  }

  etherTransfers(recipient, total, cb) {
    // Instantiate web3 with WebSocket provider
    const web3 = this.getWeb3ws();

    // Instantiate subscription object
    const subscription = web3.eth.subscribe('pendingTransactions');

    // Subscribe to pending transactions
    subscription
      .subscribe((error, result) => {
        if (error) console.error(error);
      })
      .on('data', async txHash => {
        try {
          // Instantiate web3 with HttpProvider
          const web3Http = this.getWeb3Http();

          // Get transaction details
          const trx = await web3Http.eth.getTransaction(txHash);

          const valid = this.validate(trx, total, recipient);
          // If transaction is not valid, simply return
          if (!valid) return;

          if (CONF.ENABLE_LOGS) {
            console.log('trx', trx);
            console.log(
              `Found incoming Ether transaction from ${trx.from} to ${trx.to}`
            );
            console.log(`Transaction value is: ${trx.value}`);
            console.log(`Transaction hash is: ${txHash}\n`);
          }

          // CB for detected transactions
          cb({
            state: WatcherTx.STATES.DETECTED,
            tx: trx,
            txHash
          });

          // Initiate transaction confirmation
          this.confirmTransaction(txHash, CONF.confirmationNeeded, cb);

          // Unsubscribe from pending transactions.
          subscription.unsubscribe();
        } catch (error) {
          console.log(error);
        }
      });
  }

  tokenTransfers(contractAddress, ABI, recipient, value, cb) {
    // Instantiate web3 with WebSocketProvider
    const web3 = this.getWeb3ws();

    // Instantiate token contract object with JSON ABI and address
    const tokenContract = new web3.eth.Contract(
      ABI,
      contractAddress,
      (error, result) => {
        if (error) console.log(error);
      }
    );

    // Generate filter options
    const options = {
      filter: {
        _to: recipient,
        _value: value
      },
      fromBlock: 'latest'
    };

    // Subscribe to Transfer events matching filter criteria
    tokenContract.events.Transfer(options, async (error, event) => {
      if (error) {
        console.log(error);
        return;
      }

      if (CONF.ENABLE_LOGS) {
        console.log('event', event);
      }

      // Initiate transaction confirmation
      this.confirmTransaction(
        event.transactionHash,
        CONF.confirmationNeeded,
        cb
      );
    });
  }

  async getConfirmations(txHash) {
    try {
      // Instantiate web3 with HttpProvider
      const web3 = this.getWeb3Http();

      // Get transaction details
      const trx = await web3.eth.getTransaction(txHash);

      // Get current block number
      const currentBlock = await web3.eth.getBlockNumber();

      // When transaction is unconfirmed, its block number is null.
      // In this case we return 0 as number of confirmations
      return trx.blockNumber === null ? 0 : currentBlock - trx.blockNumber;
    } catch (error) {
      console.log(error);
    }
  }

  confirmTransaction(txHash, confirmations = CONF.confirmationNeeded, cb) {
    setTimeout(async () => {
      // Get current number of confirmations and compare it with sought-for value
      const trxConfirmations = await this.getConfirmations(txHash);

      if (CONF.ENABLE_LOGS) {
        console.log(
          `Transaction with hash ${txHash} has ${trxConfirmations} confirmation(s)`
        );
      }

      if (trxConfirmations >= confirmations) {
        // Handle confirmation event according to your business logic

        if (CONF.ENABLE_LOGS) {
          console.log(
            `Transaction with hash ${txHash} has been successfully confirmed`
          );
        }

        cb({
          state: WatcherTx.STATES.CONFIRMED,
          txHash
        });

        return;
      }
      // Recursive call
      return this.confirmEtherTransaction(txHash, confirmations, cb);
    }, 30 * 1000);
  }
}
