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
    var copied = utxos.slice();
    copied.sort(function (u0, u1) {
      if (options.minimizeInputs) {
        return u1.value - u0.value; // larger values first to minimize inputs
      } else {
        return (
          u0.raw.block_height === u1.raw.block_height
            ? u1.value - u0.value  // larger values first to avoid excess change
            // prefer earlier nlocktime:
            : u0.raw.block_height - u1.raw.block_height
        );
      }
    });

    var collected = [];
    var collectedTotal = Promise.resolve(0);

    for (var i = 0; i < copied.length; ++i) {
      (function (i) {
        collectedTotal = collectedTotal.then(function (curTotal) {
          if (options.nonCTOnly && !copied[i].value) {
            return curTotal;
          }
          return copied[ i ].getValue().then(function (nextValue) {
            if (curTotal >= requiredValue) {
              return curTotal;
            }

            var increase = 0;
            if (!options.subtractFeeFromOut &&
              options.increaseNeededValueForEachOutputBy &&
              options.isFeeAsset) {
              increase = options.increaseNeededValueForEachOutputBy;
            }

            var nextOut = copied[ i + 1 ];
            if (nextOut !== undefined &&
                  (copied[ i ].raw.block_height === nextOut.raw.block_height ||
                   options.minimizeInputs) && // ignore nlocktime to minimize inputs
                  nextOut.value >= requiredValue - curTotal + increase) {
              // next one is enough - skip this one which is too large
              return curTotal;
            }

            collected.push(copied[ i ]);
            requiredValue += increase;
            return curTotal + nextValue;
          });
        });
      })(i);
    }
    return collectedTotal.then(function (total) {
      if (total < requiredValue) {
        var err = new Error(message);
        err.notEnoughMoney = true;
        throw err;
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
    options.message || 'Not enough money',
    extendCopy(options, { isFeeAsset: true })
  )(options.utxo || this.utxo);
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
  var _this = this;
  // 1. get fee estimate
  var feeEstimate = this.feeEstimatesFactory.getFeeEstimate(1)[0];

  // 2. create the transaction, looping until we have enough inputs provided
  var tx = new this.Transaction();
  if (options.locktime) {
    tx.tx.locktime = options.locktime;
  }
  var builtTxData;
  var oldNeededValue = (
    this._initializeNeededValue(outputsWithAmounts, options, feeEstimate)
  );

  var collectOptions = extendCopy(
    options, {
      // 42 is very conservative
      // (just prevout[32b]+previdx[4b]+seq[4b]+len[1b]+script[1b])
      // -- for sure the accuracy could be improved for CT, where
      // transactions become much larger due to rangeproofs
      increaseNeededValueForEachOutputBy: 42 * feeEstimate / 1000
    });
  var checkNonInstant = Promise.resolve();
  if (options.instantUtxo) {
    checkNonInstant = this._collectOutputs(oldNeededValue, collectOptions);
  }

  return checkNonInstant.then(function () {
    var message, utxo;
    if (options.instantUtxo) {
      message = (
        'You need to wait for previous transactions to get at least %s confirmations'
      ).replace('%s', options.minConfs);
      utxo = options.instantUtxo;
    }
    return _this._collectOutputs(
      oldNeededValue, extend(collectOptions, {message: message, utxo: utxo})
    );
  }).then(function (prevOutputs) {
    var constantFee = false;
    var feeMultiplier;
    if (options.addFee) {
      if (options.addFee.multiplier) {
        feeMultiplier = options.addFee.multiplier;
      } else {
        constantFee = options.addFee.isConstant;
        feeEstimate = options.addFee.amount;
      }
    }

    return tx.build(extend({
      outputsWithAmounts: outputsWithAmounts,
      // start with inputs set based on needed value, which likely doesn't
      // include all the necessary fees -- it can be increased later by the
      // `iterate` call below:
      prevOutputs: prevOutputs,
      feeEstimate: feeEstimate,
      constantFee: constantFee,
      feeMultiplier: feeMultiplier,
      getChangeOutScript: this.changeAddrFactory.getNextOutputScriptWithPointer.bind(
        this.changeAddrFactory
      )
    }, this.buildOptions, options)).then(
      iterate.bind(this)
    ).then(
      // 3. sign the transaction
      this.signingWallet.signTransaction.bind(
        this.signingWallet,
        tx,
        extend({
          utxoFactory: this.utxoFactory
        }, options)
      )
    ).then(function () {
      return extend(tx, builtTxData);
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
  options = options || {};
  var _this = this;

  var utxoDeferred;
  if (!options.minConfs) {
    if (!this.utxoDeferred) {
      this.refreshUtxo();
    }
    utxoDeferred = _this.utxoDeferred;
  } else {
    utxoDeferred = _this.utxoFactory.listAllUtxo({minConfs: options.minConfs});
  }
  return utxoDeferred.then(function (utxo) {
    var utxoOptions = {};
    if (options.minConfs) {
      // we'll just use default this.utxo below in the call stack
      // if minConfs is not specified
      utxoOptions = {instantUtxo: utxo};
    }
    return _this._constructTx(
      outputsWithAmounts,
      extend(utxoOptions, options || {})
    ).catch(function (err) {
      if (err.notEnoughMoney && !options.minimizeInputs) {
        return _this._constructTx(
          outputsWithAmounts,
          extend(utxoOptions, options || {}, {minimizeInputs: true})
        );
      } else {
        return Promise.reject(err);
      }
    });
  });
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
