var hid = require('node-hid');

module.exports = {
  getDevices: nodeGetDevices,
  connect: nodeConnect,
  send: nodeSend,
  sendFeatureReport: nodeSendFeatureReport,
  receive: nodeReceive,
  disconnect: nodeDisconnect
};

function nodeGetDevices (options, cb) {
  var ret = [];
  options.filters.forEach(function (filter) {
    try {
      ret = ret.concat(hid.devices(filter.vendorId, filter.productId));
    } catch (e) {
      console.log(e);
    }
  });
  ret.forEach(function (dev) {
    dev.deviceId = dev.path;
  });
  cb(ret);
}
function nodeConnect (deviceId, cb) {
  cb({connectionId: new hid.HID(deviceId)});
}
function nodeSend (dev, reportId, data, cb) {
  data = Array.from(new Uint8Array(data));
  if (reportId) {
    data = [reportId].concat(data);
  }
  dev.write(data);
  cb();
}
function nodeSendFeatureReport (dev, reportId, data, cb) {
  data = Array.from(new Uint8Array(data));
  if (reportId) {
    data = [reportId].concat(data);
  }
  try {
    dev.sendFeatureReport(data);
  } catch (e) { }
  cb();
}
function nodeReceive (dev, cb) {
  dev.read(function (_, data) {
    cb(0, data);
  });
}
function nodeDisconnect (dev, cb) {
  dev.close();
  cb();
}
