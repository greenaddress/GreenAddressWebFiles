var window = require('global/window');
var document = require('global/document');

var Electrum = window.Electrum;
var gettext = window.gettext;
var wss_url = window.wss_url;
var dev_d = window.dev_d;
var Bitcoin = window.Bitcoin;
var ByteString = window.ByteString;
var HEX = window.HEX;

var AssetsWallet = require('wallet').GA.AssetsWallet;
var GAService = require('wallet').GA.GAService;
var GAWallet = require('wallet').GA.GAWallet;

module.exports = factory;

factory.dependencies = ['$q',
  '$rootScope',
  'cordovaReady',
  '$http',
  'notices',
  'gaEvent',
  '$location',
  'autotimeout',
  'device_id',
  'btchip',
  'mnemonics',
  'storage'
];

function factory ($q, $rootScope, cordovaReady, $http, notices, gaEvent, $location, autotimeout, device_id, btchip, mnemonics, storage) {
  var txSenderService = {
    call: call,
    logged_in: false,
    login: login,
    logout: logout,
    loginWatchOnly: loginWatchOnly,
    change_pin: change_pin,
    gaService: new GAService(
      window.cur_net === Bitcoin.bitcoin.networks.testnet ? 'testnet' : 'mainnet',
      {wsUrl: wss_url}
    )
  };

  // disable electrum setup
  if (false && window.Electrum) {
    if (window.cordova) {
      txSenderService.electrum = new Electrum($http, $q);
    } else {
      txSenderService.electrum = new Electrum();
      txSenderService.electrum.connectToServer();
    }
  }
  var connection;
  var session;
  var session_for_login;
  var calls_missed = {};
  var isMobile = /Android|iPhone|iPad|iPod|Opera Mini/i.test(navigator.userAgent);
  var connecting = false;
  var nconn = 0;
  var waiting_for_device = false;

  if (window.cordova) {
    cordovaReady(function () {
      document.addEventListener('resume', function () {
        if (!txSenderService.wallet || !txSenderService.logged_in) return;
        if (session || session_for_login) {
          connection.close(); // reconnect on resume
        }
        session = session_for_login = null;
        txSenderService.gawallet = null;
        txSenderService.wallet.update_balance();
      }, false);
    })();
  } else if (isMobile && typeof document.addEventListener !== undefined) {
    // reconnect on tab shown in mobile browsers
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && txSenderService.wallet && txSenderService.logged_in) {
        txSenderService.wallet.update_balance();
      }
    }, false);
  }

  cordovaReady(connect)();

  return txSenderService;

  function onLogin (data) {
    var s = session || session_for_login;
    s.subscribe('com.greenaddress.txs.wallet_' + data.receiving_id,
      function (event) {
        gaEvent('Wallet', 'TransactionNotification');
        $rootScope.$broadcast('transaction', event[0]);
      });
    s.subscribe('com.greenaddress.fee_estimates',
      function (event) {
        $rootScope.$broadcast('fee_estimate', event[0]);
      });
  }
  function call () {
    return txSenderService.gaService.call(
      arguments[0], Array.prototype.slice.call(arguments, 1)
    );
  }
  function connect (login_d) {
    txSenderService.gaService.connect();
  }
  // @TODO: refactor indentation hell to be function
  function login (logout, force_relogin, user_agent, path_seed, path, mnemonic) {
    var d_main = $q.defer();
    var d;
    if (txSenderService.logged_in && !force_relogin) {
      d_main.resolve(txSenderService.logged_in);
    } else {
      var hdwallet = txSenderService.hdwallet;
      if (hdwallet.keyPair.d) {
        if (session_for_login) {
          session_for_login.call('com.greenaddress.login.get_challenge', [hdwallet.getAddress().toString()])
            .then(function (challenge) {
              var challenge_bytes = new Bitcoin.BigInteger(challenge).toBuffer();

              // generate random path to derive key from - avoids signing using the same key twice
              var random_path_hex = Bitcoin.BigInteger
                .fromBuffer(Bitcoin.randombytes(8))
                .toString(16);

              while (random_path_hex.length < 16) {
                random_path_hex = '0' + random_path_hex;
              }

              $q.when(hdwallet.subpath_for_login(random_path_hex)).then(function (subhd) {
                $q.when(subhd.keyPair.sign(challenge_bytes)).then(function (signature) {
                  d_main.resolve(device_id().then(function (devid) {
                    if (session_for_login && session_for_login.nc === nconn) {
                      signature = [signature.r.toString(), signature.s.toString()];
                      var args = [
                        signature,
                        logout || false,
                        random_path_hex,
                        devid,
                        user_agent
                      ];
                      return session_for_login.call('com.greenaddress.login.authenticate', args)
                        .then(function (data) {
                          if (data) {
                            txSenderService.logged_in = data;

                            var gaUserPath;
                            if (data.gait_path) {
                              gaUserPath = data.gait_path;
                            } else if (path) {
                              gaUserPath = path;
                            } else if (path_seed) {
                              gaUserPath = mnemonics.seedToPath(path_seed);
                            }

                            var WalletClass = window.cur_net.isAlphaMultiasset ? AssetsWallet : GAWallet;
                            txSenderService.gawallet = new WalletClass({
                              existingSession: {
                                session: session_for_login,
                                hdwallet: txSenderService.hdwallet,
                                mnemonic: mnemonic,
                                gaUserPath: gaUserPath,
                                loginData: data
                              },
                              unblindedCache: {
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
                              }
                            });

                            onLogin(data);
                            return data;
                          } else {
                            return $q.reject(gettext('Login failed'));
                          }
                        });
                    } else if (!connecting) {
                      d = $q.defer();
                      connect(d);
                      d_main.resolve(d.promise);
                    }
                  }));
                });
              });
            });
        } else if (!connecting) {
          d = $q.defer();
          connect(d);
          d_main.resolve(d.promise);
        }
      } else { // trezor_dev || btchip
        if (waiting_for_device) return;
        var trezor_dev = txSenderService.trezor_dev;
        var btchip_dev = txSenderService.btchip;
        var hwDevice = txSenderService.hwDevice;
        var get_pubkey = function () {
          if (hwDevice) {
            return $q.when(txSenderService.hdwallet.keyPair.getAddress());
          } else if (trezor_dev) {
            return $q.when(txSenderService.trezor_address);
          } else {
            return $q.when(txSenderService.btchip_address);
          }
        };
        get_pubkey().then(function (addr) {
          if (session_for_login) {
            if (hwDevice) {
              dev_d = $q.when(dev_d);
            } else if (trezor_dev) {
              dev_d = $q.when(trezor_dev);
            } else {
              dev_d = btchip.getDevice(false, true,
                // FIXME not sure why it doesn't work with Cordova
                // ("suspend app, disconnect dongle, resume app, reconnect dongle" case fails)
                window.cordova ? null : btchip_dev)
                .then(function (btchip_dev_) {
                  txSenderService.btchip = btchip_dev = btchip_dev_;
                });
            }
            waiting_for_device = true;
            var challenge_arg_resolves_main = false;
            var getChallengeArguments = function () {
              if (hwDevice) {
                return hwDevice.getChallengeArguments();
              } else {
                return Promise.when(['com.greenaddress.login.get_trezor_challenge', addr, !trezor_dev]);
              }
            };
            dev_d = dev_d.then(function () {
              if (session_for_login) {
                return getChallengeArguments().then(function (args) {
                  return session_for_login.call(
                    args[0], args.slice(1)
                  );
                });
              } else if (!connecting) {
                waiting_for_device = false;
                d = $q.defer();
                connect(d);
                challenge_arg_resolves_main = true;
                return d.promise;
              } else waiting_for_device = false;
            });
            d_main.resolve(dev_d.then(function (challenge) {
              if (challenge_arg_resolves_main) return challenge;
              if (!challenge) return $q.defer().promise; // never resolve

              var msg_plain = 'greenaddress.it      login ' + challenge;
              var msg = (new Bitcoin.Buffer.Buffer(
                msg_plain, 'utf8'
              )).toString('hex');
              // btchip requires 0xB11E to skip HID authentication
              // 0x4741 = 18241 = 256*G + A in ASCII
              var path = [0x4741b11e];

              if (hwDevice) {
                return hwDevice.signMessage(path, msg).then(function (res) {
                  return Promise.all([Promise.resolve(res), device_id()]);
                }).then(function (resAndId) {
                  var res = resAndId[0];
                  var devid = resAndId[1];
                  return session_for_login.call('com.greenaddress.login.authenticate', [
                    [res.r.toString(), res.s.toString(), res.i.toString()],
                    logout || false,
                    'GA',
                    devid
                  ]).then(function (data) {
                    if (data) {
                      txSenderService.logged_in = data;
                      onLogin(data);
                      return data;
                    } else { return $q.reject(gettext('Login failed')); }
                  });
                });
              } else if (trezor_dev) {
                trezor_dev.signing = true;
                return trezor_dev._typedCommonCall('SignMessage', 'MessageSignature',
                  {'message': msg, address_n: path})
                  .then(function (res) {
                    var sig = res.message.signature;
                    sig = sig.toHex ? sig.toHex() : sig;
                    var signature = Bitcoin.bitcoin.ECSignature.parseCompact(
                      new Bitcoin.Buffer.Buffer(sig, 'hex')
                    );
                    trezor_dev.signing = false;
                    return device_id().then(function (devid) {
                      return session_for_login.call('com.greenaddress.login.authenticate', [
                        [signature.signature.r.toString(), signature.signature.s.toString(), signature.i.toString()],
                        logout || false,
                        'GA',
                        devid
                      ]).then(function (data) {
                        if (data) {
                          txSenderService.logged_in = data;
                          onLogin(data);
                          return data;
                        } else { return $q.reject(gettext('Login failed')); }
                      });
                    });
                  }, function (err) {
                    trezor_dev.signing = false;
                    return $q.reject(err.message);
                  });
              } else {
                // var t0 = new Date()
                return $q.when(hdwallet.derive(path[0])).then(function (result_pk) {
                  return btchip_dev.signMessagePrepare_async(path.join('/'), new ByteString(msg, HEX)).then(function (result) {
                    return btchip_dev.app.signMessageSign_async(new ByteString('00', HEX)).then(function (result) {
                      waiting_for_device = false;
                      var signature = Bitcoin.bitcoin.ECSignature.fromDER(
                        new Bitcoin.Buffer.Buffer('30' + result.bytes(1).toString(HEX), 'hex')
                      );
                      var i;
                      if (btchip_dev.features.signMessageRecoveryParam) {
                        i = result.byteAt(0) & 0x01;
                      } else {
                        i = Bitcoin.ecdsa.calcPubKeyRecoveryParam(
                          Bitcoin.BigInteger.fromBuffer(Bitcoin.message.magicHash(msg_plain)),
                          {r: signature.r, s: signature.s},
                          result_pk.keyPair.Q
                        );
                      }
                      return device_id().then(function (devid) {
                        if (session_for_login && session_for_login.nc === nconn) {
                          return session_for_login.call('com.greenaddress.login.authenticate', [
                            [signature.r.toString(), signature.s.toString(), i.toString()],
                            logout || false,
                            'GA',
                            devid
                          ]).then(function (data) {
                            if (data) {
                              txSenderService.logged_in = data;
                              onLogin(data);
                              return data;
                            } else { return $q.reject(gettext('Login failed')); }
                          });
                        } else if (!connecting) {
                          d = $q.defer();
                          connect(d);
                          return d.promise;
                        }
                      });
                    });
                  });
                });
              }
            }).finally(function () { waiting_for_device = false; }));
          } else if (!connecting) {
            d = $q.defer();
            connect(d);
            d_main.resolve(d.promise);
          }
        });
      }
    }
    return d_main.promise;
  }
  function logout () {
    if (session) {
      connection.close();
      session = session_for_login = null;
      txSenderService.gawallet = null;
    }
    for (var key in calls_missed) {
      delete calls_missed[key];
    }
    if (txSenderService.btchip) {
      txSenderService.btchip.dongle.disconnect_async();
    }
    txSenderService.logged_in = false;
    txSenderService.hdwallet = undefined;
    txSenderService.trezor_dev = undefined;
    txSenderService.watch_only = undefined;
    txSenderService.pin_ident = undefined;
    txSenderService.has_pin = undefined;
    if (txSenderService.wallet) txSenderService.wallet.clear();
  }
  function loginWatchOnly (token_type, token, logout) {
    var d = $q.defer();
    txSenderService.call('com.greenaddress.login.watch_only', token_type, token, logout || false)
      .then(function (data) {
        txSenderService.watch_only = [token_type, token];
        onLogin(data);
        d.resolve(data);
      }, function (err) {
        d.reject(err);
      });
    return d.promise;
  }
  function change_pin (new_pin, device_ident) {
    return txSenderService.call(
      'com.greenaddress.pin.change_pin_login',
      new_pin,
      device_ident || txSenderService.pin_ident
    ).then(function (res) {
      // keep new pin for reconnection handling
      if (!res) {
        return $q.reject(gettext('Changing PIN failed.'));
      } else {
        txSenderService.pin = new_pin;
      }
    });
  }
}
