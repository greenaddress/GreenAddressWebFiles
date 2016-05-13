var window = require('global/window');

module.exports = factory;

factory.dependencies = ['storage'];

function factory (storage) {
  var uuid4 = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var nums = new Uint32Array(1);
      var r;
      var v;

      window.crypto.getRandomValues(nums);
      r = nums[0] % 16;
      v = (c === 'x') ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
  return function () {
    return storage.get('device_id').then(function (value) {
      if (!value) {
        var ret = uuid4();
        storage.set('device_id', ret);
        return ret;
      } else return value;
    });
  };
}
