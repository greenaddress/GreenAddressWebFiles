var document = require('global/document');

var FB = window.FB;
var FB_APP_ID = window.FB_APP_ID;
var CDV = window.CDV;

module.exports = factory;

factory.dependencies = ['$q', '$rootScope', 'cordovaReady', '$interval'];

function factory ($q, $rootScope, cordovaReady, $interval) {
  if (!document.getElementById('fb-root')) return;

  var FB_deferred = $q.defer();
  var FB_promise = FB_deferred.promise;
  var initd = false;
  window.fbAsyncInit = function () {
    $interval.cancel(FB_interval_promise);
    cordovaReady(function () {
      FB_deferred.resolve();
    })();
  };
  if (window.cordova) {
    // fbAsyncInit is not called for some reason in Cordova, so we poll for FB
    var FB_interval_promise = $interval(function () {
      if (window.FB) {
        window.fbAsyncInit();
      }
    }, 100, 50); // try for 5 seconds
  }

  cordovaReady(function () {
    var e = document.createElement('script');
    e.async = true;
    e.src = 'https://connect.facebook.net/en_US/all.js';
    document.getElementById('fb-root').appendChild(e);
  })();

  var logged_in = false;
  var login_deferred = $q.defer();
  FB_promise = FB_promise.then(function () {
    FB.Event.subscribe('auth.authResponseChange', function (response) {
      if (response.status === 'connected') {
        logged_in = true;
        $rootScope.safeApply(function () {
          login_deferred.resolve();
        });
      }
    });

    if (window.cordova) {
      FB.init({
        appId: FB_APP_ID,
        nativeInterface: CDV.FB,
        useCachedDialogs: false
      });
    } else {
      FB.init({
        appId: FB_APP_ID,
        status: true
      });
    }

    initd = true;
  });

  var facebookService = {};
  facebookService.login = function (loginstate) {
    if (loginstate.logging_in && !initd) return;
    if (logged_in) {
      loginstate.logged_in = true;
      return $q.when(true);
    }
    loginstate.logging_in = true;
    var deferred = $q.defer();
    FB.login(function (response) {
      $rootScope.$apply(function () {
        if (response.authResponse) {
          loginstate.logged_in = true;
          deferred.resolve();
        } else {
          deferred.reject();
        }
        loginstate.logging_in = false;
      });
    }, {scope: ''});
    return deferred.promise;
  };

  facebookService.getUser = function () {
    login_deferred = login_deferred.then(function () {
      var inner_deferred = $q.defer();
      FB.api('/me', function (response) {
        $rootScope.$apply(function () {
          inner_deferred.resolve(response);
        });
      });
      return inner_deferred.promise;
    });
    return login_deferred;
  };

  return facebookService;
}
