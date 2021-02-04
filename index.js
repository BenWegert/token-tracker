require("dotenv").config();

const { abi, chatID, tgKey, rpc, debug } = require("./config");
const RLP = require("rlp");
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(tgKey);
const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.WebsocketProvider(rpc));
const Contract = web3.eth.Contract;

const NodeCache = require("node-cache");
const pendingTokens = new NodeCache({
  stdTTL: 10,
  checkperiod: 3,
  maxKeys: 500,
});
const retries = new NodeCache({
  stdTTL: 1,
  checkperiod: 1,
  maxKeys: 2000,
});

pendingTokens.on("expired", (hash, contract) => {
  if (contract.attempts < 1000) {
    pendingTokens.set(hash, { ...contract, attempts: contract.attempts + 1 });
    checkToken(hash);
  } else {
    console.log(`[INFO]: Removed ${hash}`);
  }
});

retries.on("expired", (key, value) => {
  scanTx(key);
});

const main = async () => {
  web3.eth
    .subscribe("pendingTransactions")
    .on("connected", async () => {
      log(`[INFO]: Listening for token deployments:`);
    })
    .on("data", async (hash) => {
      scanTx(hash);
    })
    .on("error", async (error) => {
      log("[ERROR]: " + error);
    });
};

const scanTx = async (hash) => {
  tx = await web3.eth.getTransaction(hash);

  if (tx) {
    if (tx.to == null) {
      const contractAddress =
        "0x" +
        web3.utils
          .sha3(RLP.encode([tx.from, tx.nonce]))
          .slice(12)
          .substring(14);

      const balance = parseFloat(
        web3.utils.fromWei((await web3.eth.getBalance(tx.from)) || "0", "ether")
      ).toFixed(2);

      pendingTokens.set(hash, { balance, contractAddress, attempts: 0 });
    }
  } else {
    var hashRetries = retries.get(hash);
    if (hashRetries == undefined) {
      try {
        retries.set(hash, 1, 1);
      } catch (error) {}
    } else if (hashRetries < 4) {
      try {
        retries.set(
          hash,
          hashRetries + 1,
          hashRetries * Math.floor(Math.random() * 4)
        );
      } catch (error) {}
    }
  }
};

const checkToken = async (hash) => {
  var { contractAddress, balance } = pendingTokens.get(hash);

  try {
    var code = await web3.eth.getCode(contractAddress);
  } catch (error) {
    var code = "0x";
  }

  if (code !== "0x") {
    var newToken = new Contract(abi, contractAddress);

    try {
      const [name, symbol] = await Promise.all([
        newToken.methods.name().call(),
        newToken.methods.symbol().call(),
      ]);

      if (name && symbol) {
        createMessage({ name, symbol, contractAddress, balance });
      }

      pendingTokens.del(hash);
    } catch (error) {
      pendingTokens.del(hash);
    }
  }
};

const createMessage = async (token) => {
  var message = `Address with balance of <b>${token.balance} ETH</b> deployed <b>${token.name} (${token.symbol})</b>\r\n<a href="https://etherscan.io/address/${token.contractAddress}">details</a>`;
  log(message);
};

const log = (message) => {
  try {
    if (debug) {
      console.log(message);
    }
    bot.sendMessage(chatID, message, {
      parse_mode: "html",
    });
  } catch (e) {
    console.log(e);
  }
};

main();
