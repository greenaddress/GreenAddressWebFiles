var window = require('global/window');

var cordova = window.cordova;
var gettext = window.gettext;

module.exports = factory;

factory.dependencies = ['$q', 'cordovaReady'];

function factory ($q, cordovaReady) {
  return {
    copy: function (data) {
      var deferred = $q.defer();
      cordovaReady(function () {
        cordova.plugins.clipboard.copy(data, function () {
          deferred.resolve(gettext('Copied'));
        }, function () {
          deferred.reject(gettext('Error copying'));
        });
      })();
      return deferred.promise;
    }
  };
}
