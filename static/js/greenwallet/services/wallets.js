var extend = require('xtend/mutable');
var is_chrome_app = require('has-chrome-storage');
var window = require('global/window');
var AssetsWallet = require('wallet').GA.AssetsWallet;
var GAWallet = require('wallet').GA.GAWallet;
var HashSwSigningWallet = require('wallet').GA.HashSwSigningWallet;
var HwSigningWallet = require('wallet').GA.HwSigningWallet;
var SchnorrSigningKey = require('wallet').bitcoinup.SchnorrSigningKey;
var Transaction = require('wallet').bitcoinup.Transaction;
var bitcoin = require('bitcoinjs-lib');

///@TODO Refactor this file, it's huge and crazy. Also get it to pass lint

var gettext = window.gettext;
var LANG = window.LANG;
var BASE_URL = window.BASE_URL;
var Bitcoin = window.Bitcoin;

module.exports = factory;

factory.dependencies = [
  '$q',
  '$rootScope',
  'tx_sender',
  '$location',
  'notices',
  '$uibModal',
  'focus',
  'crypto',
  'gaEvent',
  'storage',
  'storage_keys',
  'mnemonics',
  'addressbook',
  'autotimeout',
  'social_types',
  'sound',
  '$interval',
  '$timeout',
  'branches',
  'user_agent',
  '$http',
  'blind'
];

function factory ($q, $rootScope, tx_sender, $location, notices, $uibModal,
  focus, crypto, gaEvent, storage, storage_keys, mnemonics, addressbook,
  autotimeout, social_types, sound, $interval, $timeout, branches, user_agent,
  $http, blind) {
  var walletsService = {};
  walletsService.requireWallet = function ($scope, dontredirect) {
    if (!$scope.wallet.hdwallet && !$scope.wallet.trezor_dev && !$scope.wallet.btchip) {
      if (!dontredirect) {
        var location = '/?redir=' + $location.path();
        var search = [];
        for (var key in $location.search()) {
          search.push(key + '=' + encodeURIComponent($location.search()[key]));
        }
        if (search) {
          location += encodeURIComponent('?' + search.join('&'));
        }
        $location.url(location);
        $scope.processWalletVars(); // update payment values with redir value
      }
      return false;
    }
    return true;
  };
  walletsService.updateAppearance = function ($scope, key, value) {
    var oldValue = $scope.wallet.appearance[key];
    $scope.wallet.appearance[key] = value;
    return tx_sender.call('com.greenaddress.login.set_appearance', JSON.stringify($scope.wallet.appearance)).catch(function (e) {
      $scope.wallet.appearance[key] = oldValue;
      return $q.reject(e);
    });
  };
  walletsService.openInitialPage = function (wallet, has_txs) {
    if ($location.search().redir) {
      $location.url($location.search().redir);
    } else if (!has_txs) {
      $location.path('/receive');
    } else if (window.IS_MOBILE || wallet.send_to_receiving_id || wallet.send_to_payment_request) {
      $location.path('/send');
    } else {
      $location.url('/info');
    }
  };
  var unblindedCache = {
    _key: function (txhash, pt_idx) {
      var rev = [].reverse.call(new Bitcoin.Buffer.Buffer(txhash));
      return (
        'unblinded_value_' + rev.toString('hex') +
        ':' + pt_idx
      );
    },
    getValue: function (txhash, pt_idx) {
      return storage.get(this._key(txhash, pt_idx)).then(function (val) {
        return +val; // convert to a number
      });
    },
    setValue: function (txhash, pt_idx, value) {
      return storage.set(
        this._key(txhash, pt_idx),
        value
      );
    }
  };
  walletsService.walletFromHD = function ($scope, hd, options) {
    options = options || {};
    var WalletClass = window.cur_net.isAlphaMultiasset ? AssetsWallet : GAWallet;
    return new WalletClass({
      SigningWalletClass: HashSwSigningWallet,
      signingWalletOptions: {
        hd: new SchnorrSigningKey(hd, options),
        schnorrTx: cur_net.isAlpha
      },
      gaService: tx_sender.gaService,
      unblindedCache: unblindedCache,
      loginLater: true,
      userAgent: user_agent($scope.wallet)
    });
  };
  walletsService.walletFromHW = function ($scope, hwDevice, options) {
    options = options || {};
    var WalletClass = window.cur_net.isAlphaMultiasset ? AssetsWallet : GAWallet;
    return hwDevice.getPublicKey().then(function (hdwallet) {
      return new WalletClass({
        SigningWalletClass: HwSigningWallet,
        signingWalletOptions: extend(
          { hw: hwDevice, hd: hdwallet },
          { loginProgressCb: options.progressCb }
        ),
        gaService: tx_sender.gaService,
        unblindedCache: unblindedCache,
        loginLater: true,
        userAgent: user_agent($scope.wallet)
      })
    });
  }
  walletsService.loginWithHDWallet = function ($scope, hd, options) {
    options = options || {};
    return walletsService.newLogin(
      $scope, walletsService.walletFromHD($scope, hd, options), options
    ).then(function (data) { walletsService.onLogin($scope, data); return data; });
  };
  walletsService.loginWithHWWallet = function ($scope, hwDevice, options) {
    options = options || {};
    return walletsService.walletFromHW(
      $scope, hwDevice, options
    ).then(function (wallet) {
      return walletsService.newLogin(
        // Note signup doesn't call this function, instead it calls newLogin
        // directly because it has to call signingWalletFromHW earlier anyway.
        $scope, wallet, extend({signupOnFailure: true}, options)
      );
    }).then(function (data) { walletsService.onLogin($scope, data); return data; });
  };
  walletsService.onLogin = function ($scope, data) {
    if (data.appearance.use_segwit == null && // false would mean user-disabled
        $scope.wallet.segwit_server) {
      walletsService.updateAppearance($scope, 'use_segwit', true).then(function () {
        $scope.wallet.show_segwit_notice = true;
      });
    }
  }
  walletsService.newLogin = function ($scope, gaWallet, options) {
    options = options || {};
    var d = $q.defer();
    gaWallet.service.addNotificationCallback('wallet', function (event) {
      gaEvent('Wallet', 'TransactionNotification');
      $rootScope.$broadcast('transaction', event[ 0 ]);
    });
    gaWallet.service.addNotificationCallback('feeEstimates', function (event) {
      $rootScope.$broadcast('fee_estimate', event[ 0 ]);
    });
    gaWallet.service.addNotificationCallback('blocks', function (event) {
      $rootScope.$broadcast('block', event[ 0 ]);
    });
    gaWallet.connectedHandler = function () {
      $rootScope.$broadcast('connect');
    };
    gaWallet.disconnectedHandler = function (reason, message) {
      if (reason === 'lost' || reason === 'unreachable' || reason === 'offline') {
        $rootScope.$broadcast('disconnect', message);
      } else {
        console.error(reason + ', ' + message);
      }
    };
    gaWallet.offlineHandler = function () {
        gaWallet.disconnectedHandler('offline', 'received offline event');
    };
    gaWallet.onlineHandler = function () {
        gaWallet.connectedHandler();
    };
    gaWallet.login();
    gaWallet.loggedIn.then(function (data) {
      if (data) {
        if (window.disableEuCookieComplianceBanner) {
          window.disableEuCookieComplianceBanner();
        }
        if (gaWallet.watchOnlyHDWallet) {
          $scope.wallet.hdwallet = gaWallet.watchOnlyHDWallet;
        } else if (gaWallet.signingWallet.keysManager.privHDWallet) {
          // we use wallet.hdwallet to check if we're logged in in many places:
          $scope.wallet.hdwallet = gaWallet.signingWallet.keysManager.privHDWallet.hdnode;
        } else if (gaWallet.signingWallet.hw) {
          $scope.wallet.hdwallet = gaWallet.signingWallet.keysManager.pubHDWallet.hdnode;
          // we use hwDevice for such checks too:
          $scope.wallet.hwDevice = gaWallet.signingWallet.hw;
        }
        tx_sender.logged_in = true;
        tx_sender.wallet = $scope.wallet;
        tx_sender.gaWallet = gaWallet;
        if (gaWallet.signingWallet) {
          $scope.wallet.mnemonic = gaWallet.signingWallet.mnemonic;
        }
        if (data.last_login) {
          $scope.wallet.last_login = data.last_login;
        }
        $scope.wallet.appearance = data.appearance;
        gaWallet.service.appearance = $scope.wallet.appearance;
        if (cur_net.isAlphaMultiasset && !window.cordova && !is_chrome_app) {
          if (data.theme && data.theme.css) {
            var sheet = window.document.styleSheets[0];
            sheet.insertRule(data.theme.css, sheet.cssRules.length);
          }
          if (data.theme && data.theme.js) {
            try {
              eval(data.theme.js);
            } catch (e) {
              console.log(e);
            }
          }
        }
        $scope.wallet.fee_estimates = data.fee_estimates;
        $scope.wallet.rbf = data.rbf;
        $scope.wallet.segwit_server = data.segwit_server;
        if (!('sound' in $scope.wallet.appearance)) {
          $scope.wallet.appearance.sound = true;
        }
        if (!('pgp' in $scope.wallet.appearance)) {
          $scope.wallet.appearance.pgp = '';
        }
        if (!('altimeout' in $scope.wallet.appearance)) {
          $scope.wallet.appearance.altimeout = 20;
        }
        if (data.rbf && !('replace_by_fee' in $scope.wallet.appearance)) {
          $scope.wallet.appearance.replace_by_fee = data.rbf;
        }
        sound.play(BASE_URL + '/static/sound/coinreceived.mp3', $scope);
        autotimeout.start($scope.wallet.appearance.altimeout);
        $scope.wallet.privacy = data.privacy;
        $scope.wallet.limits = data.limits;
        $scope.wallet.subaccounts = gaWallet.subaccounts;
        if (cur_net.isAlphaMultiasset) {
          $scope.wallet.assets = data.assets;
        } else {
          $scope.wallet.assets = {undefined: {name: 'BTC'}};
        }
        $scope.wallet.current_subaccount = $scope.wallet.appearance.current_subaccount || 0;
        $scope.wallet.current_asset = $scope.wallet.appearance.current_asset || 1;
        $scope.wallet.unit = $scope.wallet.appearance.unit || 'mBTC';
        $scope.wallet.cache_password = data.cache_password;
        $scope.wallet.fiat_exchange = data.exchange;
        $scope.wallet.fiat_exchange_extended = $scope.exchanges[data.exchange];
        $scope.wallet.receiving_id = data.receiving_id;
        $scope.wallet.expired_deposits = data.expired_deposits;
        $scope.wallet.nlocktime_blocks = data.nlocktime_blocks;
        $scope.wallet.gait_path = data.gait_path;
        // create a per-wallet keyname to store segwit lockin status
        $scope.wallet.segwit_locked_key =
          Bitcoin.bitcoin.crypto.sha256(
            Bitcoin.Buffer.Buffer.concat(
              [Bitcoin.Buffer.Buffer(data.gait_path), Bitcoin.Buffer.Buffer('segwit_locked')])).toString('hex');
        if (!options.signup && !options.needsPINSetup) {
          // don't change URL on initial login in signup or PIN setup
          walletsService.openInitialPage($scope.wallet, data.has_txs);
        }
        $scope.wallet.update_balance(data);
        $rootScope.$broadcast('login');
      } else if (!options.signup) { // signup has its own error handling
        d.reject();
        return;
      }
      d.resolve(data);
    }).catch(function (e) { d.reject(e); });
    return d.promise.catch(function (err) {
      if (options.signupOnFailure && err === 'Login failed') {
        notices.makeNotice('error', gettext('User not found.'));
        $location.path('/create');
      } else {
        console.log(err);
        notices.makeNotice('error', gettext('Login failed') + (err && err.args && err.args[ 1 ] && (': ' + err.args[ 1 ]) || ''));
        return $q.reject(err);
      }
    });
  };
  walletsService.loginWatchOnly = function ($scope, tokenType, token) {
    var WalletClass = window.cur_net.isAlphaMultiasset ? AssetsWallet : GAWallet;
    return walletsService.newLogin($scope, new WalletClass({
      watchOnly: {
        tokenType: tokenType,
        token: token
      },
      gaService: tx_sender.gaService,
      loginLater: true
    })).then(function (data) {
      $scope.wallet.watchOnly = true;
      return data;
    });
  };
  walletsService.getTransactions = function ($scope, notifydata, query, sorting, date_range, subaccount) {
    return addressbook.load($scope).then(function () {
      return walletsService._getTransactions($scope, notifydata, null, query, sorting, date_range, subaccount);
    });
  };
  var parseSocialDestination = function (social_destination) {
    try {
      var data = JSON.parse(social_destination);
      if (data.type == 'voucher') return gettext('Voucher');
      else return social_destination;
    } catch (e) {
      return social_destination;
    }
  };
  var unblindOutputs = function ($scope, txData, rawTxs) {
    var deferreds = [];
    var tx = bitcoin.Transaction.fromHex(txData.data);
    for (var i = 0; i < txData.eps.length; ++i) {
      (function (ep) {
        if (ep.value === null && (ep.is_relevant || ep.pubkey_pointer)) {
          // e.pubkey_pointer !== null means it's our ep, can be
          // from different subaccount than currently processed
          var txhash, pt_idx, out, subaccount;
          if (ep.is_credit) {
            txhash = txData.txhash;
            pt_idx = ep.pt_idx;
            out = tx.outs[ep.pt_idx];
            subaccount = ep.subaccount;
          } else {
            txhash = ep.prevtxhash;
            pt_idx = ep.previdx;
            out = bitcoin.Transaction.fromHex(
              rawTxs[ep.prevtxhash]
            ).outs[pt_idx];
            subaccount = ep.prevsubaccount;
          }
          var key =
          'unblinded_value_' + txhash + ':' + pt_idx;
          var d = storage.get(key).then(function (value) {
            if (value === null) {
              return blind.unblindOutValue(
                $scope, out, subaccount || 0, ep.pubkey_pointer
              ).then(function (data) {
                ep.value = data.value;
                storage.set(key, data.value);
              });
            } else {
              ep.value = value;
            }
          });
          deferreds.push(d);
        }
      })(txData.eps[i]);
    }
    return $q.all(deferreds);
  };
  walletsService._getTransactions = function ($scope, notifydata, page_id, query, sorting, date_range, subaccount) {
    var transactions_key = $scope.wallet.receiving_id + 'transactions';
    var d = $q.defer();
    $rootScope.is_loading += 1;
    var unclaimed = [];

    if (sorting) {
      var sort_by = sorting.order_by;
      if (sorting.reversed) { sort_by = '-' + sort_by; }
    } else {
      var sort_by = null;
    }
    sorting = sorting || {order_by: 'ts', reversed: true};
    var end = date_range && date_range[1] && new Date(date_range[1]);
    if (end) end.setDate(end.getDate() + 1);
    var date_range_iso = date_range && [date_range[0] && date_range[0].toISOString(),
      end && end.toISOString()];
    var args = ['com.greenaddress.txs.get_list_v2',
      page_id, query, sort_by, date_range_iso, subaccount];
    if (cur_net.isAlpha) {
      // return prev data
      args.push(true);
    }
    var call = tx_sender.call.apply(tx_sender, args);

    if (cur_net.isAlpha) {
      call = call.then(function (data) {
        var deferreds = [];
        var valid = {};
        for (var i = 0; i < data.list.length; i++) {
          (function (i) {
            var tx = data.list[i];
            tx.data = data.data[tx.txhash];
            valid[i] = true;
            deferreds.push(unblindOutputs($scope, tx, data.data)
              .catch(function (e) {
                if (e !== 'Invalid transaction.') {
                  throw e;
                } else {
                  // skip invalid transactions
                  valid[i] = false;
                }
              }));
          })(i);
        }
        return $q.all(deferreds).then(function () {
          var orig_list = data.list;
          data.list = [];
          for (var i = 0; i < orig_list.length; ++i) {
            if (valid[i]) data.list.push(orig_list[i]);
          }
          return data;
        });
      });
    }

    call.then(function (data) {
      $scope.wallet.cur_block = data.cur_block;
      var retval = [];
      var any_unconfirmed_seen = false;
      var asset_name = null;
      // this used to be shadowed over and over and we relied on variable hoisting for it to work
      // that's confusing, just define it here and assign it below
      var description;
      for (var i = 0; i < data.list.length; i++) {
        // description is reused in every iteration of the loop, so lets just null it out at first just in case
        description = null;
        var tx = data.list[i], inputs = [], outputs = [];
        var ga_asset_id;
        for (var j = 0; j < tx.eps.length; ++j) {
          if (tx.eps[j].is_credit && tx.eps[j].is_relevant) {
            ga_asset_id = tx.eps[j].ga_asset_id;
          }
        }
        if (ga_asset_id) {
          var num_confirmations = data.cur_block[ga_asset_id] - tx.block_height + 1;
          asset_name = $scope.wallet.assets[ga_asset_id].name;
        } else {
          var num_confirmations = data.cur_block - tx.block_height + 1;
        }

        any_unconfirmed_seen = any_unconfirmed_seen || (num_confirmations < 6 && !tx.double_spent_by);

        var value = new Bitcoin.BigInteger('0'),
          in_val = new Bitcoin.BigInteger('0'), out_val = new Bitcoin.BigInteger('0'),
          redeemable_value = new Bitcoin.BigInteger('0'), sent_back_from, redeemable_unspent = false,
          pubkey_pointer, sent_back = false, from_me = false, tx_social_destination, tx_social_value,
          asset_values = [], asset_values_map = {};
        var negative = false, positive = false, unclaimed = false, external_social = false;
        for (var j = 0; j < tx.eps.length; j++) {
          var ep = tx.eps[j];
          if (ep.is_relevant && !ep.is_credit) from_me = true;
        }
        for (var j = 0; j < tx.eps.length; j++) {
          var ep = tx.eps[j];
          if (ep.is_relevant) {
            if (ep.is_credit) {
              var bytes = Bitcoin.bs58.decode(ep.ad);
              var version = bytes[0];
              var _external_social = version != cur_net.scriptHash;
              external_social = external_social || _external_social;

              if (ep.social_destination && external_social) {
                pubkey_pointer = ep.pubkey_pointer;
                if (!from_me) {
                  redeemable_value = redeemable_value.add(new Bitcoin.BigInteger(ep.value));
                  sent_back_from = parseSocialDestination(ep.social_destination);
                  redeemable_unspent = redeemable_unspent || !ep.is_spent;
                }
              } else {
                addValue(
                  ep.ga_asset_id, new Bitcoin.BigInteger(''+ep.value)
                );
                ep.nlocktime = true;
              }
            } else {
              addValue(
                ep.ga_asset_id,
                (new Bitcoin.BigInteger(''+ep.value))
                  .multiply(Bitcoin.BigInteger.valueOf(-1))
              );
            }
          }
          if (ep.is_credit) {
            outputs.push(ep);
            out_val = out_val.add(new Bitcoin.BigInteger(''+ep.value));
          } else { inputs.push(ep); in_val = in_val.add(new Bitcoin.BigInteger(''+ep.value)); }
        }
        if (value.compareTo(new Bitcoin.BigInteger('0')) > 0 || redeemable_value.compareTo(new Bitcoin.BigInteger('0')) > 0) {
          positive = true;

          if (tx.issuance) {
            description = gettext('Asset Issuance');
          } else if (redeemable_value.compareTo(new Bitcoin.BigInteger('0')) > 0) {
            description = gettext('Back from ') + sent_back_from;
          } else {
            description = gettext('From ');
            var addresses = [];
            for (var j = 0; j < tx.eps.length; j++) {
              var ep = tx.eps[j];
              if (!ep.is_credit && !ep.is_relevant) {
                if (ep.social_source) {
                  if (addresses.indexOf(ep.social_source) == -1) {
                    addresses.push(ep.social_source);
                  }
                } else {
                  var ad = addressbook.reverse[ep.ad] || ep.ad;
                  if (addresses.indexOf(ad) == -1) {
                    addresses.push(ad);
                  }
                }
              }
            }
            description += addresses.length ? addresses[0] : '';
            if (addresses.length > 1) {
              description += ', ...';
            }
          }
        } else {
          negative = value.compareTo(new Bitcoin.BigInteger('0')) < 0;
          var addresses = [];
          description = gettext('To ');
          for (var j = 0; j < tx.eps.length; j++) {
            var ep = tx.eps[j];
            if (ep.is_credit && (!ep.is_relevant || ep.social_destination)) {
              if (ep.social_destination && ep.social_destination_type != social_types.PAYMENTREQUEST) {
                try {
                  tx_social_destination = JSON.parse(ep.social_destination);
                  tx_social_value = ep.value;
                } catch (e) {}
                pubkey_pointer = ep.pubkey_pointer;
                var bytes = Bitcoin.bs58.decode(ep.ad);
                var version = bytes[0];
                var _external_social = version != cur_net.scriptHash;
                external_social = external_social || _external_social;
                if (!ep.is_spent && ep.is_relevant) {
                  unclaimed = true;
                  addresses.push(parseSocialDestination(ep.social_destination));
                } else if (!ep.is_relevant && external_social) {
                  sent_back = true;
                  addresses.push(ep.ad);
                } else {
                  addresses.push(parseSocialDestination(ep.social_destination));
                }
              } else if (ep.social_destination && ep.social_destination_type == social_types.PAYMENTREQUEST) {
                if (addresses.indexOf(ep.social_destination) == -1) {
                  addresses.push(ep.social_destination);
                }
              } else {
                var ad = addressbook.reverse[ep.ad] || ep.ad;
                addresses.push(ad);
              }
            }
          }

          if (sent_back) {
            description = gettext('Sent back to ');
          }
          if (!addresses.length) {
            description = gettext('Re-deposited');
          } else {
            description += addresses.join(', ');
          }
        }
        // prepend zeroes for sorting
        var value_sort = new Bitcoin.BigInteger(Math.pow(10, 19).toString()).add(value).toString();
        while (value_sort.length < 20) value_sort = '0' + value_sort;
        asset_values.sort(function (a, b) {
          // sort by ga_asset_id == 1, then by asset name
          if ((a.ga_asset_id == 1) != (b.ga_asset_id == 1))
            var a1 = (a.ga_asset_id == 1), b1 = (b.ga_asset_id == 1);
          else
            var a1 = a.name, b1 = b.name;
          return a1 > b1 ? -1 : a1 == b1 ? 0 : -1;
        });
        retval.push({ts: new Date(tx.created_at.replace(' ', 'T')), txhash: tx.txhash, memo: tx.memo,
          value_sort: value_sort, value: value, instant: tx.instant,
          value_fiat: data.fiat_value ? value * data.fiat_value / Math.pow(10, 8) : undefined,
          redeemable_value: redeemable_value, negative: negative, positive: positive,
          description: description, external_social: external_social, unclaimed: unclaimed,
          description_short: addresses.length ? addresses.join(', ') : description,
          pubkey_pointer: pubkey_pointer, inputs: inputs, outputs: outputs, fee: tx.fee,
          nonzero: value.compareTo(new Bitcoin.BigInteger('0')) != 0,
          redeemable: redeemable_value.compareTo(new Bitcoin.BigInteger('0')) > 0,
          redeemable_unspent: redeemable_unspent,
          sent_back: sent_back, block_height: tx.block_height,
          confirmations: tx.block_height ? num_confirmations : 0,
          has_payment_request: tx.has_payment_request,
          double_spent_by: tx.double_spent_by, replaced_by: tx.replaced_by,
          replacement_of: [],
          rawtx: cur_net.isAlpha ? data.data[tx.txhash] : tx.data,
          social_destination: tx_social_destination, social_value: tx_social_value,
          ga_asset_id: ga_asset_id, asset_name: asset_name, size: tx.size,
          fee_per_kb: Math.round(tx.fee / (tx.size / 1000)),
          rbf_optin: !cur_net.isAlphaMultiasset && tx.rbf_optin,
          issuance: tx.issuance,
          asset_values: asset_values});
        // tx.unclaimed is later used for cache updating
        tx.unclaimed = retval[0].unclaimed || (retval[0].redeemable && retval[0].redeemable_unspent);
      }
      var hash2tx = {};
      for (var i = 0; i < retval.length; ++i) {
        hash2tx[retval[i].txhash] = retval[i];
      }
      var new_retval = [];
      for (var i = 0; i < retval.length; ++i) {
        var merged = false;
        if (retval[i].replaced_by && retval[i].replaced_by.length > 0) {
          var replaced_by = retval[i].replaced_by;
          for (var j = 0; j < replaced_by.length; ++j) {
            var tx = hash2tx[replaced_by[j]];
            if (tx && !(tx.replaced_by && tx.replaced_by.length)) {
              tx.replacement_of.push(retval[i]);
              merged = true;
              break;
            }
          }
        }
        if (!merged) {
          new_retval.push(retval[i]);
        }
      }
      retval = new_retval;
      d.resolve({fiat_currency: data.fiat_currency, list: retval, sorting: sorting, date_range: date_range, subaccount: subaccount,
        populate_csv: function () {
          var csv_list = [gettext('Time,Description,satoshis,%s,txhash,fee,memo').replace('%s', this.fiat_currency)];
          for (var i = 0; i < this.list.length; i++) {
            var item = this.list[i];
            csv_list.push(item.ts + ',' + item.description.replace(',', "'") + ',' + item.value + ',' + item.value_fiat + ',' + item.txhash + ',' + item.fee + ',' + item.memo);
          }
          this.csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv_list.join('\n'));
        },
        next_page_id: data.next_page_id,
        fetch_next_page: function () {
          var that = this;
          walletsService._getTransactions($scope, notifydata, that.next_page_id, query, that.sorting, that.date_range, that.subaccount).then(function (result) {
            that.list = that.list.concat(result.list);
            that.next_page_id = result.next_page_id;
          });
        },
        sort_by: function (sorting) {
          var that = this;
          walletsService._getTransactions($scope, notifydata, null, query, sorting, that.date_range, that.subaccount).then(function (result) {
            that.sorting = sorting;
            if (sorting.order_by == 'ts' && sorting.reversed) {
              that.pending_from_notification = false;
              that.pending_conf_from_notification = false;
            }
            that.list = result.list;
            that.next_page_id = result.next_page_id;
          });
      }});
      function addValue (ga_asset_id, v) {
        value = value.add(v);
        if (!asset_values_map[ga_asset_id]) {
          asset_values_map[ga_asset_id] = {
            name: $scope.wallet.assets[ga_asset_id].name,
            value: Bitcoin.BigInteger.valueOf(0)
          };
          asset_values_map[ga_asset_id].apply_unit = (ga_asset_id == 1);
          asset_values.push(asset_values_map[ga_asset_id]);
        }
        var asset = asset_values_map[ga_asset_id];
        asset.value = asset.value.add(v);
      }
    }, function (err) {
      notices.makeNotice('error', err.args[1]);
      d.reject(err);
    }).finally(function () { $rootScope.decrementLoading(); });
    return d.promise;
  };
  walletsService.ask_for_tx_confirmation = function (
    $scope, tx, options
  ) {
    options = options || {};
    if (!($scope.send_tx || $scope.bump_fee)) {
      // not all txs support this dialog, like redepositing or sweeping
      return $q.when();
    }
    var scope = $scope.$new(), fee, value;
    if (tx.ins[0].prevOut && tx.ins[0].prevOut.data) {
      var in_value = 0, out_value = 0;
      tx.ins.forEach(function (txin) {
        var prevtx = bitcoin.Transaction.fromHex(
          txin.prevOut.data.toString('hex')
        );
        var prevout = prevtx.outs[txin.index];
        in_value += prevout.value;
      });
      tx.outs.forEach(function (txout) {
        out_value += txout.value;
      });
      fee = in_value - out_value;
    } else {
      fee = options.fee;
    }
    if (options.value) {
      value = options.value;
    } else if ($scope.send_tx && $scope.send_tx.amount == 'MAX') {
      value = $scope.wallet.final_balance - fee;
    } else if (options.bumped_tx) {
      value = -options.bumped_tx.value;
    } else {
      value = $scope.send_tx.amount_to_satoshis($scope.send_tx.amount);
    }
    scope.tx = {
      fee: fee,
      previous_fee: options.bumped_tx && options.bumped_tx.fee,
      value: value,
      recipient: options.recipient ? options.recipient :
        (($scope.send_tx && $scope.send_tx.voucher) ?
          gettext('Voucher') :
          ($scope.send_tx ?
            ($scope.send_tx.recipient.name ||
            $scope.send_tx.recipient) :
            gettext("back to myself"))),
      is_min_fee_rate: options.is_min_fee_rate,
      min_fee_rate: tx_sender.gaService.getMinFeeRate()
    };
    var modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_confirm_tx.html',
      scope: scope,
      windowClass: 'twofactor' // is a 'sibling' to 2fa - show with the same z-index
    });
    return modal.result;
  };
  walletsService.sign_tx = function ($scope, tx, options) {
    options = options || {};

    return tx_sender.gaWallet.signingWallet.signTransaction(
      tx, {signingProgressCallback: options.progressCb}
    ).then(function () {
      return tx.tx.ins.map(function (inp, i) {
        var signature;
        var decompiled = Bitcoin.bitcoin.script.decompile(inp.script);
        if (decompiled[0] === 0) {  // multisig
          signature = decompiled[2];
        } else if (decompiled.length === 2) {
          // assume pkhash-spending script
          signature = decompiled[0];
        } else if (decompiled.length === 1) {
          // assume segwit
          signature = inp.witness[0];
        }
        return signature.toString('hex');
      });
    });
  };
  walletsService.getSubaccount = function ($scope, pointer) {
    pointer = pointer || 0;
    var subaccount = null;
    $scope.wallet.subaccounts.forEach(function (sub) {
      if (pointer === sub.pointer) {
        subaccount = sub;
      }
    });
    return subaccount;
  };
  walletsService.sign_and_send_tx = function ($scope, data, options) {
    options = options || {};

    var d = $q.defer();
    var tx = new Transaction();
    tx.tx = bitcoin.Transaction.fromHex(data.tx);

    // we can use the utxoFactory from the BTC/mainaccount constructor because
    // the asset/subaccount doesn't matter for the purposes of utxoFactory's
    // fetchUtxoDataForTx, which is the only usage we have here.
    var btcMainConstructor = tx_sender.gaWallet.txConstructors[1][0];
    data.prev_outputs.forEach(function (prevOut, i) {
      tx.tx.ins[i].prevOut = {
        raw: extend({
          txhash: Bitcoin.bitcoin.bufferutils.reverse(
            tx.tx.ins[i].hash
          ).toString('hex')
        }, prevOut),
        value: +prevOut.value,
        subaccount: walletsService.getSubaccount($scope, prevOut.subaccount),
        privkey: prevOut.privkey,
        script: (typeof prevOut.script === 'string'
          ? new Bitcoin.Buffer.Buffer(prevOut.script, 'hex')
          : prevOut.script
        )
      };
    });
    var prevouts_d = btcMainConstructor.utxoFactory.fetchUtxoDataForTx(tx.tx);

    var d_all = prevouts_d.then(function (prevouts) {
      return walletsService.sign_tx($scope, tx, options);
    });
    var send_after = options.sendAfter || $q.when();
    d_all = d_all.then(function (signatures) {
      return walletsService.ask_for_tx_confirmation(
        $scope, tx.tx, extend({value: options.value}, options)
      ).then(function () {
        return signatures;
      });
    });
    var do_send = function () {
      return d_all.then(function (signatures) {
        var ret;

        if (data.requires_2factor && !data.twofactor_data) {
          ret = walletsService.attempt_two_factor($scope, 'send_tx', {}, function (twofac_data) {
            return attempt(twofac_data);
          });
        } else {
          ret = attempt(data.twofactor_data || null);
        }

        ret.then(d.resolve).catch(function (error) {
          d.reject(error);
          notices.makeNotice('error', gettext('Transaction failed: ') + error.args[ 1 ]);
          sound.play(BASE_URL + '/static/sound/wentwrong.mp3', $scope);
        });

        function attempt (twofactor) {
          return tx_sender.call('com.greenaddress.vault.send_tx', signatures, twofactor || null).then(function (data) {
            if (!twofactor && $scope) {
              tx_sender.call('com.greenaddress.login.get_spending_limits').then(function (data) {
                $scope.wallet.limits.total = data.total;
              });
            }
            sound.play(BASE_URL + '/static/sound/coinsent.mp3', $scope);
            notices.makeNotice('success', gettext('Bitcoin transaction sent!'));
          });
        }
      });
    };
    send_after.then(do_send).catch(d.reject);
    return d.promise;
  };
  walletsService.getTwoFacConfig = function ($scope, force) {
    var d = $q.defer();
    if ($scope.wallet.twofac !== undefined && !force) {
      d.resolve($scope.wallet.twofac);
    } else {
      tx_sender.call('com.greenaddress.twofactor.get_config').then(function (data) {
        $scope.wallet.twofac = data;
        d.resolve($scope.wallet.twofac);
      });
    }
    return d.promise;
  };
  walletsService.attempt_two_factor = function ($scope, action, options, cb) {
    options = options || {};
    options.data = options.data || {};
    options.data.cb = cb;
    return walletsService.get_two_factor_code($scope, action, options.data, options.redeposit);
  };
  walletsService.get_two_factor_code = function ($scope, action, data, redeposit) {
    data = data || {};
    var deferred = $q.defer();
    var attemptsLeft = 3;
    var cb;
    if (data.cb) {
      cb = data.cb;
      delete data.cb;
    }
    walletsService.getTwoFacConfig($scope).then(function (twofac_data) {
      if (twofac_data.any) {
        $scope.twofactor_method_names = {
          'gauth': 'Google Authenticator',
          'email': 'Email',
          'sms': 'SMS',
          'phone': gettext('Phone')
        };
        $scope.twofactor_methods = [];
        for (var key in $scope.twofactor_method_names) {
          if (twofac_data[key] === true) {
            $scope.twofactor_methods.push(key);
          }
        }
        var order = ['gauth', 'email', 'sms', 'phone'];
        $scope.twofactor_methods.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
        $scope.twofac = {
          twofactor_method: $scope.twofactor_methods[0],
          codes_requested: {},
          request_code: function () {
            var that = this;
            this.requesting_code = true;
            return tx_sender.call('com.greenaddress.twofactor.request_' + this.twofactor_method,
              action, data).then(function () {
              that.codes_requested[that.twofactor_method] = true;
              that.requesting_code = false;
            }, function (err) {
              notices.makeNotice('error', err.args[1]);
              that.requesting_code = false;
            });
        }};
        var show_modal = function (retVal) {
          var modal = $uibModal.open({
            templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_2fa.html',
            scope: $scope,
            windowClass: 'twofactor'
          });
          modal.opened.then(function () { focus('twoFactorModal'); });
          var modalResult = modal.result.then(function (twofac_data) {
            if (twofac_data.method == 'gauth' && redeposit) {
              return tx_sender.call('com.greenaddress.twofactor.request_redeposit_proxy', twofac_data).then(function (data) {
                return {'method': 'proxy', 'code': data};
              });
            } else {
              return twofac_data;
            }
          });
          if (!cb) {
            deferred.resolve(modalResult);
          } else {
            var res = modalResult.then(function (twofac_data) {
              return cb(twofac_data).catch(function (err) {
                if (attemptsLeft > 1 && err.args && err.args[0] === 'http://greenaddressit.com/error#auth') {
                  attemptsLeft -= 1;
                  $scope.twofac.twofactor_code = '';
                  $scope.twofac.invalid_code = true;
                  return show_modal(true);
                } else {
                  return $q.reject(err);
                }
              })
            });
            if (retVal) {
              return res;
            } else {
              deferred.resolve(res);
            }
          }
        };
        if ($scope.twofactor_methods.length == 1) {
          if ($scope.twofactor_methods[0] == 'gauth') {
            // just gauth - no request required
            $scope.twofac.gauth_only = true; // don't display the radio buttons
            // (not required in 'else' because codes_requested takes care of it)
            show_modal();
          } else {
            // just sth else than gauth - request it because user can't choose anything else anyway
            $scope.twofac.twofactor_method = $scope.twofactor_methods[0];
            $scope.twofac.request_code().then(function () {
              show_modal();
            });
          }
        } else {
          // more than one auth method available - allow the user to select
          show_modal();
        }
      } else {
        if (cb) {
          return deferred.resolve(cb());
        } else {
          return deferred.resolve(null);
        }
      }
    });
    return deferred.promise;
  };
  walletsService.addCurrencyConversion = function ($scope, model_name) {
    var div = {'BTC': 1, 'mBTC': 1000, 'µBTC': 1000000, 'bits': 1000000}[$scope.wallet.unit];
    var unitPlaces = {'BTC': 8, 'mBTC': 5, 'µBTC': 2, 'bits': 2}[$scope.wallet.unit];
    var trimDecimalPlaces = function (numPlaces, val) {
      return (Math.round(val * Math.pow(10, numPlaces)) / Math.pow(10, numPlaces));
    };
    $scope.$watch(model_name + '.amount', function (newValue, oldValue) {
      // don't check for newValue == oldValue to allow conversion to happen
      // in 'send' form even when using plain (non-payreq) bitcoin: URI with amount
      var _update = function () {
        if ($scope[model_name].updated_by_conversion) {
          $scope[model_name].updated_by_conversion = false;
        } else {
          var oldFiat = $scope[model_name].amount_fiat;
          if (!newValue) {
            $scope[model_name].amount_fiat = undefined;
          } else {
            if (newValue == 'MAX') {
              $scope[model_name].amount_fiat = 'MAX';
            } else {
              $scope[model_name].amount_fiat = newValue * $scope.wallet.fiat_rate / div;
              $scope[model_name].amount_fiat = trimDecimalPlaces(2, $scope[model_name].amount_fiat);
            }
          }
          if ($scope[model_name].amount_fiat !== oldFiat) {
            $scope[model_name].updated_by_conversion = true;
          }
        }
      };
      if ($scope.wallet.fiat_rate) {
        _update();
      } else {
        $scope.$on('first_balance_updated', _update);
      }
    });
    $scope.$watch(model_name + '.amount_fiat', function (newValue, oldValue) {
      if (newValue === oldValue) return;
      var _update = function () {
        if ($scope[model_name].updated_by_conversion) {
          $scope[model_name].updated_by_conversion = false;
        } else {
          var oldBTC = $scope[model_name].amount;
          if (!newValue) {
            $scope[model_name].amount = undefined;
          } else {
            if (newValue == 'MAX') {
              $scope[model_name].amount = 'MAX';
            } else {
              $scope[model_name].amount = (div * newValue / $scope.wallet.fiat_rate);
              $scope[model_name].amount = trimDecimalPlaces(unitPlaces, $scope[model_name].amount);
            }
          }
          if ($scope[model_name].amount !== oldBTC) {
            $scope[model_name].updated_by_conversion = true;
          }
        }
      };
      if ($scope.wallet.fiat_rate) {
        _update();
      } else {
        $scope.$on('first_balance_updated', _update);
      }
    });
  };
  walletsService.set_last_fiat_update = function ($scope) {
    $timeout(function () {
      var now = 1 * ((new Date()).getTime() / 1000).toFixed();
      var diff = $scope.wallet.fiat_last_fetch_ss = $scope.wallet.fiat_last_fetch ? (now - $scope.wallet.fiat_last_fetch) : 0;
      $scope.wallet.fiat_lastupdate_mm = (diff > 60) ? Math.floor(diff / 60) : 0;
      $scope.wallet.fiat_lastupdate_ss = (diff % 60);
      walletsService.set_last_fiat_update($scope);
    }, 1000);
  };
  walletsService.create_pin = function (pin, $scope, suffix) {
    suffix = suffix || '';
    var privHDWallet = tx_sender.gaWallet.signingWallet.keysManager.privHDWallet;
    if (!privHDWallet.seed) {
      return $q.reject(gettext('Internal error') + ': Missing seed');
    }
    var pin_ident;
    return tx_sender.call(
      'com.greenaddress.pin.set_pin_login', pin, 'Primary'
    ).then(function (value_id) {
      if (!value_id) {
        return $q.reject(gettext('Failed creating PIN.'));
      }
      pin_ident = tx_sender[ 'pin_ident'+suffix ] = value_id;
      storage.set(storage_keys.PIN_ID+suffix, pin_ident);
      storage.set(
        storage_keys.PIN_CHAINCODE+suffix,
        $scope.wallet.hdwallet.chainCode.toString('hex')
      );
      return tx_sender.call(
        'com.greenaddress.pin.get_password', pin, value_id
      );
    }).then(function (password) {
      if (!password) {
        return $q.reject(gettext('Failed retrieving password.'));
      }
      var value_raw = JSON.stringify({
        'seed': privHDWallet.seed.toString('hex'),
        'path_seed': privHDWallet.pathSeed.toString('hex'),
        'mnemonic':  privHDWallet.mnemonic
      });
      crypto.encrypt(value_raw, password).then(function (value_set) {
        storage.set(storage_keys.ENCRYPTED_SEED+suffix, value_set);
        if (!suffix) {
          // chaincode is not used for Touch ID
          storage.set(storage_keys.PIN_CHAINCODE, value_set);
        }
      });
      tx_sender.pin = pin;
      return pin_ident;
    }).catch(function(err) {
      return $q.reject(err.args ? err.args[0] : err);
    });
  };
  walletsService.askForLogout = function ($scope, text) {
    $scope.ask_for_logout_text = text;
    return $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_logout.html',
      scope: $scope
    }).result;
  };
  walletsService.verify_mnemonic = function($scope, options) {
    options = options || {};
    var verified = false;
    return new Promise(function (resolve, reject) {
      var scope = $scope.$new();
      gaEvent('Wallet', 'VerifyMnemonicModal');
      var indices = scope.verify_mnemonics_words_indices = [];
      scope.all_words = scope.wallet.mnemonic.split(' ');
      scope.verified_mnemonic_words = ['', '', '', ''];
      scope.verified_mnemonic_errors = ['', '', '', ''];
      scope.signup = options.signup;
      scope.indices = {};
      for (var i = 0; i < 4; i++) {
        indices.push(Math.floor(Math.random() * 24));
        while (indices.indexOf(indices[indices.length - 1]) < indices.length - 1) {
          indices[indices.length - 1] = Math.floor(Math.random() * 24);
        }
      }
      indices.sort(function(a, b) { return a - b; });
      indices.forEach(function (v, i) {
        scope.indices[v] = i + 1;
      });
      scope.verify_mnemonic_submit = function() {
        var valid = true;
        var valid_words = scope.wallet.mnemonic.split(' ');
        for (var i = 0; i < 4; i++) {
          if (!scope.verified_mnemonic_words[i]) {
            scope.verified_mnemonic_errors[i] = gettext('Please provide this word');
            valid = false;
          } else if (scope.verified_mnemonic_words[i] != valid_words[indices[i]]) {
            scope.verified_mnemonic_errors[i] = gettext('Incorrect word');
            valid = false;
          } else {
            scope.verified_mnemonic_errors[i] = '';
          }
        }

        verified = valid;
        if (verified) {
          modal.close();
          walletsService.updateAppearance(scope, 'mnemonic_verified', 'true').catch(function(e) {
            notices.makeNotice('error', e);
          });
          resolve();
        }
      };

      var modal = $uibModal.open({
        templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_verify_mnemonic.html',
        scope: scope
      });
      modal.result.catch(function () {
        if (options.signup && !verified) {
          notices.makeNotice(
            'error',
            gettext('Please back up and verify your mnemonic before continuing.')
          );
          reject();
        }
      });
    });
  }
  return walletsService;
}
