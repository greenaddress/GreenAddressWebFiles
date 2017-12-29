var window = require('global/window');
var bitcoinup = require('./bitcoinup/index.js');
var extend = require('xtend/mutable');
var extendCopy = require('xtend');

var gettext = window.gettext;

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

            var nextOut = copied[ i + 1 ];
            if (nextOut !== undefined &&
                  (copied[ i ].raw.block_height === nextOut.raw.block_height ||
                   options.minimizeInputs) && // ignore nlocktime to minimize inputs
                  nextOut.value >= requiredValue - curTotal) {
              // next one is enough - skip this one which is too large
              return curTotal;
            }

            collected.push(copied[ i ]);
            return curTotal + nextValue;
          });
        });
      })(i);
    }
    return collectedTotal.then(function (total) {
      if (total < requiredValue) {
        var err = new Error(function (args) {
          var message = message ||
                        gettext('Not enough money, you need ${missing_satoshis} more ${unit} to cover the transaction and fee');
          Object.keys(args).forEach(function (argName) {
            message = message.replace('${' + argName + '}', args[argName]);
          });
          return message;
        }({'missing_satoshis': options.satoshisToUnit(requiredValue - total),
           'unit': options.walletUnit}));
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
    options.message,
    extendCopy(options, { isFeeAsset: true })
  )(options.utxo || this.utxo);
}

function _initializeNeededValue (outputsWithAmounts, options, feeEstimate) {
  var total = 0;
  outputsWithAmounts.forEach(function (output) {
    total += output.value;
  });
  return total;
}

function _increaseNeededValue (oldVal, newVal) {
  return Math.max(oldVal, newVal);
}

function _constructTx (outputsWithAmounts, options) {
  options = options || {};
  var _this = this;
  // 1. get fee estimate
  var feeEstimate = this.feeEstimatesFactory.getFeeEstimate(
    options.instant,
    (options.addFee && options.addFee.requiredNumOfBlocks) || 6
  )[0];

  // 2. create the transaction, looping until we have enough inputs provided
  var tx = new this.Transaction();
  if (options.locktime) {
    tx.tx.locktime = options.locktime;
  }
  var builtTxData;
  var oldNeededValue = (
    this._initializeNeededValue(outputsWithAmounts, options, feeEstimate)
  );

  var collectOptions = extendCopy(options);
  var collectOptionsInstant = null;
  var checkNonInstant = Promise.resolve();
  if (options.instantUtxo) {
    checkNonInstant = this._collectOutputs(oldNeededValue, collectOptions);
    // further _collectOutputs calls need to use the updated collectOptions
    // to collect instant outputs only:
    collectOptionsInstant = extendCopy(collectOptions, {
      message: (
        'You need to wait for previous transactions to get at least %s confirmations'
      ).replace('%s', options.minConfs),
      utxo: options.instantUtxo
    });
  }

  return checkNonInstant.then(function () {
    return _this._collectOutputs(
      // use collectOptions if "instant" is not enabled
      oldNeededValue, collectOptionsInstant || collectOptions
    );
  }).then(function (prevOutputs) {
    var feeMultiplier;
    if (options.addFee) {
      if (options.addFee.multiplier) {
        feeMultiplier = options.addFee.multiplier;
      } else {
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
      checkNonInstant = Promise.resolve();
      if (collectOptionsInstant) {
        checkNonInstant = this._collectOutputs(neededValue, collectOptions);
      }
      return checkNonInstant.then(function () {
        return _this._collectOutputs(
          // use collectOptions if "instant" is not enabled
          neededValue, collectOptionsInstant || collectOptions
        ).then(function (prevOutputs) {
          // (2) rebuild the tx
          var buildOptions = {
            outputsWithAmounts: outputsWithAmounts,
            prevOutputs: prevOutputs,
            feeEstimate: feeEstimate,
            getChangeOutScript: _this.changeAddrFactory.getNextOutputScriptWithPointer.bind(
              _this.changeAddrFactory
            ),
            // cache change out between calls, if any was generated, to avoid
            // generating multiple change addresses
            changeCache: changeCache
          };
          return tx.build(
            extend(buildOptions, _this.buildOptions, options)
          ).then(
            iterate.bind(_this)
          );
        });
      });
    } else {
      builtTxData = neededValueAndChange;
    }
  }
}

function constructTx (outputsWithAmounts, options) {
  options = options || {};
  var _this = this;

  var utxoDeferred;
  if (!this.utxoDeferred) {
    // with minConfs we need the unconfirmed-txs utxoDeferred too, for the
    // 'You need to wait for previous transactions to get at least %s confirmations'
    // check
    this.refreshUtxo();
  }
  if (!options.minConfs) {
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
