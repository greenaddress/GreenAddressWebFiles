var window = require('global/window');
var document = require('global/document');

var gettext = window.gettext;
var wss_url = window.wss_url;
var Bitcoin = window.Bitcoin;

var GAService = require('wallet').GA.GAService;

module.exports = factory;

factory.dependencies = ['$q',
  'cordovaReady'
];

function factory ($q, cordovaReady) {
  var txSenderService = {
    call: call,
    logged_in: false,
    logout: logout,
    change_pin: change_pin,
    gaService: new GAService(
      window.cur_net === Bitcoin.bitcoin.networks.testnet ? 'testnet' : 'mainnet',
      {wsUrl: wss_url}
    )
  };

  var isMobile = /Android|iPhone|iPad|iPod|Opera Mini/i.test(navigator.userAgent);

  if (window.cordova) {
    cordovaReady(function () {
      document.addEventListener('resume', function () {
        if (!txSenderService.wallet || !txSenderService.logged_in) return;
        if (txSenderService.gaService.connection) {
          txSenderService.gaService.connection.close(); // reconnect on resume
          connect(null, txSenderService.wallet.update_balance);
        }
      }, false);
    })();
  } else if (isMobile && typeof document.addEventListener !== undefined) {
    // reconnect on tab shown in mobile browsers
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && txSenderService.wallet && txSenderService.logged_in) {
        txSenderService.gaService.connection.close(); // reconnect on resume
        connect(null, txSenderService.wallet.update_balance);
      }
    }, false);
  }

  cordovaReady(connect)();

  return txSenderService;
  function call () {
    return txSenderService.gaService.call(
      arguments[0], Array.prototype.slice.call(arguments, 1)
    );
  }
  function connect () {
    txSenderService.gaService.connect();
  }
  function logout () {
    if (txSenderService.gaService.connection) {
      txSenderService.gaService.disconnect();
      connect();
      txSenderService.gawallet = null;
    }
    if (txSenderService.btchip) {
      txSenderService.btchip.dongle.disconnect_async();
    }
    txSenderService.logged_in = false;
    txSenderService.hdwallet = undefined;
    txSenderService.gaWallet = undefined;
    txSenderService.watch_only = undefined;
    txSenderService.pin_ident = undefined;
    txSenderService.has_pin = undefined;
    if (txSenderService.wallet) txSenderService.wallet.clear();
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
