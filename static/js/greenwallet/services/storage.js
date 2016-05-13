var window = require('global/window');
var storage = require('any-storage');

module.exports = factory;

factory.dependencies = ['$q'];

function factory ($q) {
  var storageService = {
    noLocalStorage: false,
    set: storage.set,
    get: function (key) {
      var d = $q.defer();
      storage.get(key, function (err, results) {
        if (err) {
          return d.reject(err);
        }
        d.resolve(results);
      });

      return d.promise;
    },
    remove: storage.remove
  };

  window.storageService = storageService;

  return storageService;
}
