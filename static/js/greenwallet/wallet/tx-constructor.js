var bitcoinup = require('./bitcoinup/index.js');
var extend = require('xtend/mutable');
var extendCopy = require('xtend');

module.exports = TxConstructor;

extend(TxConstructor.prototype, {
  constructTx: constructTx,
  getBalance: getBalance,
  refreshUtxo: refreshUtxo,
  _getBalance: _getBalance,
  _constructTx: _constructTx,
  _collectOutputs: _collectOutputs,
  _initializeNeededValue: _initializeNeededValue,
  _increaseNeededValue: _increaseNeededValue
});
TxConstructor._makeUtxoFilter = _makeUtxoFilter;

function TxConstructor (options) {
  if (!options) return; // allow inheritance

  this.signingWallet = options.signingWallet;
  this.utxoFactory = options.utxoFactory;
  this.changeAddrFactory = options.changeAddrFactory;
  this.feeEstimatesFactory = options.feeEstimatesFactory;
  this.Transaction = options.transactionClass || bitcoinup.Transaction;
  this.buildOptions = {};
}

function _makeUtxoFilter (assetNetworkId, requiredValue, message, options) {
  return processFiltered;

  function processFiltered (utxos) {
    var collected = [];
    var collectedTotal = Promise.resolve(0);
    for (var i = 0; i < utxos.length; ++i) {
      (function (i) {
        collectedTotal = collectedTotal.then(function (curTotal) {
          if (options.nonCTOnly && !utxos[i].value) {
            return curTotal;
          }
          return utxos[ i ].getValue().then(function (nextValue) {
            if (curTotal >= requiredValue) {
              return curTotal;
            }
            collected.push(utxos[ i ]);
            if (!options.subtractFeeFromOut &&
                options.increaseNeededValueForEachOutputBy &&
                options.isFeeAsset) {
              requiredValue += options.increaseNeededValueForEachOutputBy;
            }
            return curTotal + nextValue;
          });
        });
      })(i);
    }
    return collectedTotal.then(function (total) {
      if (total < requiredValue) {
        throw new Error(message);
      }
      return collected.map(process);
    });
  }
  function process (utxo) {
    utxo.assetNetworkId = assetNetworkId;
    return utxo;
  }
}

function _collectOutputs (requiredValue, options) {
  options = options || {};
  return _makeUtxoFilter(
    this.buildOptions.feeNetworkId,
    requiredValue,
    'not enough money',
    extendCopy(options, {isFeeAsset: true})
  )(this.utxo);
}

function _initializeNeededValue (outputsWithAmounts, options, feeEstimate) {
  var total = 0;
  outputsWithAmounts.forEach(function (output) {
    total += output.value;
  });
  // 16b is very conservative
  // (just version[4b]+num_inputs[1b]+num_outputs[1b]+one_output[10b]
  var initialFeeEstimate = 16 * feeEstimate / 1000;
  return total + (options.subtractFeeFromOut ? 0 : initialFeeEstimate);
}

function _increaseNeededValue (oldVal, newVal) {
  return Math.max(oldVal, newVal);
}

function _constructTx (outputsWithAmounts, options) {
  // 1. get fee estimate
  var feeEstimate = this.feeEstimatesFactory.getFeeEstimate(1)[0];

  // 2. create the transaction, looping until we have enough inputs provided
  var tx = new this.Transaction();
  var builtTxData;
  var oldNeededValue = (
    this._initializeNeededValue(outputsWithAmounts, options, feeEstimate)
  );
  return this._collectOutputs(
    oldNeededValue, extendCopy(
      options, {
        // 42 is very conservative
        // (just prevout[32b]+previdx[4b]+seq[4b]+len[1b]+script[1b])
        // -- for sure the accuracy could be improved for CT, where
        // transactions become much larger due to rangeproofs
        increaseNeededValueForEachOutputBy: 42 * feeEstimate / 1000
      })
  ).then(function (prevOutputs) {
    return tx.build(extend({
      outputsWithAmounts: outputsWithAmounts,
      // start with inputs set based on needed value, which likely doesn't
      // include all the necessary fees -- it can be increased later by the
      // `iterate` call below:
      prevOutputs: prevOutputs,
      feeEstimate: feeEstimate,
      getChangeOutScript: this.changeAddrFactory.getNextOutputScriptWithPointer.bind(
        this.changeAddrFactory
      )
    }, this.buildOptions, options)).then(
      iterate.bind(this)
    ).then(
      // 3. sign the transaction
      this.signingWallet.signTransaction.bind(this.signingWallet, tx, options)
    ).then(function () {
      return extend({
        tx: tx.tx
      }, builtTxData);
    });
  }.bind(this));

  function iterate (neededValueAndChange) {
    if (Object.prototype.toString.call(neededValueAndChange) ===
        '[object Array]') {
      // (1) collect outputs needed for the missing value
      var neededValue = neededValueAndChange[0];
      // make sure neededValue never decreases:
      neededValue = this._increaseNeededValue(neededValue, oldNeededValue);
      oldNeededValue = neededValue;
      var changeCache = neededValueAndChange[1];
      return this._collectOutputs(neededValue, options).then(function (prevOutputs) {
        // (2) rebuild the tx
        var buildOptions = {
          outputsWithAmounts: outputsWithAmounts,
          prevOutputs: prevOutputs,
          feeEstimate: feeEstimate,
          getChangeOutScript: this.changeAddrFactory.getNextOutputScriptWithPointer.bind(
            this.changeAddrFactory
          ),
          // cache change out between calls, if any was generated, to avoid
          // generating multiple change addresses
          changeCache: changeCache
        };
        return tx.build(
          extend(buildOptions, this.buildOptions, options)
        ).then(
          iterate.bind(this)
        );
      }.bind(this));
    } else {
      builtTxData = neededValueAndChange;
    }
  }
}

function constructTx (outputsWithAmounts, options) {
  if (!this.utxoDeferred) {
    this.refreshUtxo();
  }
  return this.utxoDeferred.then(function () {
    return this._constructTx(outputsWithAmounts, options || {});
  }.bind(this));
}

function _getBalance () {
  return this.utxo.reduce(
    function (prev, cur) {
      return prev.then(function (value) {
        return cur.getValue().then(function (value2) {
          return value + value2;
        });
      });
    },
    Promise.resolve(0)
  );
}

function getBalance () {
  if (!this.utxoDeferred) {
    this.refreshUtxo();
  }
  return this.utxoDeferred.then(function () {
    return this._getBalance();
  }.bind(this));
}

function refreshUtxo () {
  this.utxoDeferred = this.utxoFactory.listAllUtxo().then(function (utxo) {
    this.utxo = utxo;
  }.bind(this));
  return this.utxoDeferred;
}
