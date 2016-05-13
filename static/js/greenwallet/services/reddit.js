var window = require('global/window');

var screen = window.screen;
var REDDIT_APP_ID = window.REDDIT_APP_ID;

module.exports = factory;

factory.dependencies = ['$q'];

function factory ($q) {
  var redditService = {
    getToken: function (scope) {
      var tokenDeferred = $q.defer();
      var state = Math.random();
      var left = screen.width / 2 - 500;
      var top = screen.height / 2 - 300;
      var redir;
      if (window.location.hostname === 'localhost') {
        redir = 'http://localhost:9908/reddit/';
      } else {
        redir = 'https://' + window.location.hostname + '/reddit/';
      }
      var w = window.open('https://ssl.reddit.com/api/v1/authorize?client_id=' + REDDIT_APP_ID + '&redirect_uri=' + redir + '&response_type=code&scope=' + scope + '&state=' + state,
        '_blank', 'toolbar=0,menubar=0,width=1000,height=600,left=' + left + ',top=' + top);
      var deferred = $q.defer();
      var interval = setInterval(function () {
        if (w.closed) {
          clearInterval(interval);
          deferred.resolve(true);
        }
      }, 500);
      deferred.promise.then(function () {
        if (window._reddit_token) {
          tokenDeferred.resolve(window._reddit_token);
          window._reddit_token = undefined;
        } else {
          tokenDeferred.resolve(null);
        }
      });
      return tokenDeferred.promise;
    }
  };
  return redditService;
}
