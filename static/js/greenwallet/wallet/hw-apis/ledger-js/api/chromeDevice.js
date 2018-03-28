/*
************************************************************************
Copyright (c) 2013 UBINITY SAS

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*************************************************************************
*/

if (typeof chromeDevice == "undefined") {

if (!global.chrome) {
  var chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: function () { }
    }
  };
} else {
  var chrome = global.chrome;
}

var Q = require('../thirdparty/q/q.min')

var DEBUG = false;
function debug(message) {
  if (DEBUG) {
    console.log(message);
  }
}

function dump(array) {
  var hexchars = '0123456789ABCDEF';
  var hexrep = new Array(array.length * 2);

  for (var i = 0; i < array.length; i++) {
    hexrep[2 * i] = hexchars.charAt((array[i] >> 4) & 0x0f);
    hexrep[2 * i + 1] = hexchars.charAt(array[i] & 0x0f);
  }
  return hexrep.join('');
}

function hexToArrayBuffer(h) {
  var result = new ArrayBuffer(h.length / 2);
  var hexchars = '0123456789ABCDEFabcdef';
  var res = new Uint8Array(result);
  for (var i = 0; i < h.length; i += 2) {
    if (hexchars.indexOf(h.substring(i, i + 1)) == -1) break;
    res[i / 2] = parseInt(h.substring(i, i + 2), 16);
  }
  return result;
}

function winUSBDevice(hardwareId) {
    this.hardwareId = hardwareId;
    this.closedDevice = false;
    this.claimed = false;
    this.device = hardwareId.device;
    // Mark claimed
    for (var i=0; i<winUSBDevice.unclaimedDevices.length; i++) {
      if (winUSBDevice.unclaimedDevices.handle == this.device.handle) {
          winUSBDevice.unclaimedDevices[i] = undefined;
          break;
      }
    }
    // Locate the interface to open, the in/out endpoints and their sizes
    for (var i=0; i<hardwareId.interfaces.length; i++) {
      if (hardwareId.interfaces[i].interfaceClass == 0xff) {
          this.interfaceId = i;
          var currentInterface = hardwareId.interfaces[i];
          for (var j=0; j<currentInterface.endpoints.length; j++) {
              var currentEndpoint = currentInterface.endpoints[j];
              if (currentEndpoint.direction == "in") {
                  this.inEndpoint = 0x80 + currentEndpoint.address;
              }
              else
              if (currentEndpoint.direction == "out") {
                  this.outEndpoint = currentEndpoint.address;
              }
          }
      }
    }
}

winUSBDevice.prototype.open = function(callback) {
    debug("Open winUSBDevice " + this.interfaceId);
    debug(this.device);
    var currentDevice = this;
    chrome.usb.claimInterface(this.device, this.interfaceId, function() {
        currentDevice.claimed = true;
        chrome.runtime.sendMessage({usbClaimed: currentDevice});
        if (callback) callback(true);
    });
}

winUSBDevice.prototype.send = function(data, callback) {
      debug("=> " + data);
      chrome.usb.bulkTransfer(this.device,
        {
          direction: "out",
          endpoint: this.outEndpoint,
          data: hexToArrayBuffer(data)
        },
        function(result) {
          if (callback) {
            var exception = (result.resultCode != 0 ? "error " + result.resultCode : undefined);
            callback({
              resultCode: result.resultCode,
              exception: exception
            });
          }
        });
}

winUSBDevice.prototype.recv = function(size, callback) {
      chrome.usb.bulkTransfer(this.device,
        {
          direction: "in",
          endpoint: this.inEndpoint,
          length: size
        },
        function(result) {
            var data;
            if (result.resultCode == 0) {
              data = dump(new Uint8Array(result.data));
            }
            debug("<= " + data);
            if (callback) {
                var exception = (result.resultCode != 0 ? "error " + result.resultCode : undefined);
                callback({
                  resultCode: result.resultCode,
                  data: data,
                  exception: exception
              });
            }
        });
}

winUSBDevice.prototype.close = function(callback) {
    var currentDevice = this;
    if (this.claimed) {
      chrome.usb.releaseInterface(this.device, this.interfaceId, function() {
        currentDevice.claimed = false;
        chrome.usb.closeDevice(currentDevice.device, function() {
          currentDevice.closedDevice = true;
          chrome.runtime.sendMessage({usbClosed: currentDevice});
          if (callback) callback();
        });
      });
    }
    else
    if (!this.closedDevice) {
        chrome.usb.closeDevice(currentDevice.device, function() {
          currentDevice.closedDevice = true;
          chrome.runtime.sendMessage({usbClosed: currentDevice});
          if (callback) callback();
        });
    }
    else {
      if (callback) callback();
    }
}

winUSBDevice.unclaimedDevices = [];

winUSBDevice.enumerate = function(vid, pid, callback) {

  if (!global.chrome) {
    // no chrome.usb
    if (callback) callback([]);
    return;
  }

  // First close all unclaimed devices to avoid leaking
  for (var i=0; i<winUSBDevice.unclaimedDevices.length; i++) {
    if (typeof winUSBDevice.unclaimedDevices[i] != "undefined") {
      debug("Closing");
      debug(winUSBDevice.unclaimedDevices[i]);
      chrome.usb.closeDevice(winUSBDevice.unclaimedDevices[i]);
    }
  }
  winUSBDevice.unclaimedDevices = [];
  global.chrome.usb.findDevices({
    vendorId: vid,
    productId: pid
  },
  function(devices) {
    debug(devices);

    var probedDevicesWithInterfaces = [];
    var probedDevices = 0;

    if (devices.length == 0) {
      // No devices, answer immediately
      if (callback) callback([]);
    }

    // Locate suitable interfaces

    for (var currentDevice=0; currentDevice<devices.length; currentDevice++) {
      (function(currentDevice) {
        chrome.usb.listInterfaces(devices[currentDevice], function(interfaceList) {
          probedDevices++;
          // If the device has at least one WinUSB interface, it can be probed
          var hasWinUSB = false;
          for (var i=0; i<interfaceList.length; i++) {
            if (interfaceList[i].interfaceClass == 0xff) {
              hasWinUSB = true;
              break;
            }
          }
          if (hasWinUSB) {
            winUSBDevice.unclaimedDevices.push(devices[currentDevice]);
            probedDevicesWithInterfaces.push({
              device: devices[currentDevice],
              interfaces: interfaceList,
              transport: 'winusb'
            });
          }
          else {
            debug("Closing");
            debug(devices[currentDevice]);
            chrome.usb.closeDevice(devices[currentDevice]);
          }
          if (probedDevices == devices.length) {
            if (callback) callback(probedDevicesWithInterfaces);
          }
        }); // chrome.usb.listInterfaces
      })(currentDevice); // per device closure
    }
  }); // chrome.usb.findDevices
}


function hidDevice(hardwareId, hid) {
    this.hardwareId = hardwareId;
    this.closedDevice = false;
    this.claimed = false;
    this.device = hardwareId.device;
    this.hid = hid;
}

hidDevice.prototype.open = function(callback) {
    debug("Open hidDevice");
    debug(this.device);
    var currentDevice = this;
    this.hid.connect(this.device.deviceId, function(handle) {
        if (!handle) {
          debug("failed to connect");
          if (callback) callback(false);
        }
        currentDevice.claimed = true;
        chrome.runtime.sendMessage({usbClaimed: currentDevice});
        currentDevice.handle = handle;
        if (callback) callback(true);
    });
}

hidDevice.prototype.send = function(data, callback) {
  debug("=> " + data);
  this.hid.send(this.handle.connectionId, 0, hexToArrayBuffer(data), function() {
    if (callback) {
      var exception = (chrome.runtime.lastError ? "error " + chrome.runtime.lastError : undefined);
        callback({
          resultCode: 0,
          exception: exception
        });
    }
  });
}

hidDevice.prototype.recv = function(size, callback) {
  this.hid.receive(this.handle.connectionId, function(reportId, data) {
    var receivedData;
    if (!chrome.runtime.lastError && data) {
      receivedData = dump(new Uint8Array(data));
    }
    debug("<= " + receivedData);
    if (callback) {
      var exception = ((chrome.runtime.lastError || !data) ? "error " + chrome.runtime.lastError : undefined);
      callback({
        resultCode: 0,
        data: receivedData,
        exception: exception
      });
    }
  });
}

hidDevice.prototype.close = function(callback) {
    var currentDevice = this;
    if (this.claimed) {
      this.hid.disconnect(this.handle.connectionId, function() {
        currentDevice.claimed = false;
        currentDevice.closedDevice = true;
        chrome.runtime.sendMessage({usbClosed: currentDevice});
        if (callback) callback();
      })
    }
    else {
      currentDevice.closedDevice = true;
      chrome.runtime.sendMessage({usbClosed: currentDevice});
      if (callback) callback();
    }
}

hidDevice.enumerate = function(vid, pid, usagePage, ledger, callback) {
  function enumerated(deviceArray) {
    var probedDevices = [];
    for (var i=0; i<deviceArray.length; i++) {
      probedDevices.push({
        device: deviceArray[i],
        transport: 'hid',
        ledger: ledger
      });
    }
    if (callback) callback(probedDevices);
  }

  var done = false;

  var nodeHid;
  try {
    nodeHid = require('../../node-hid-chrome-wrapper');
  } catch (e) { }
  var hid = global.chrome ? global.chrome.hid : nodeHid;

  if (!hid || !hid.getDevices) {
    debug("HID is not available");
    enumerated([]);
    return;
  }

  if (typeof usagePage != 'undefined') {
    try {
      // Chrome 39+ only
      hid.getDevices({filters: [{usagePage: usagePage}]}, enumerated);
      done = true;
    }
    catch(e) {
    }
  }
  if (!done) {
    try {
      // Chrome 39+ only
      hid.getDevices({filters: [{vendorId: vid, productId:pid}]}, enumerated);
      done = true;
    }
    catch(e) {
      debug(e);
    }
  }
  if (!done) {
    try {
      // Chrome 38
      hid.getDevices({vendorId: vid, productId:pid}, enumerated);
    }
    catch(e) {
      debug("All HID enumeration methods failed");
      enumerated([]);
    }
  }
}


var boundDevices = [];

var chromeDevice = module.exports = function(enumeratedDevice) {
  this.device = enumeratedDevice;
}

chromeDevice.prototype.open_async = function(hid) {
  var currentDevice = this;
  var msg = {
    parameters: {
      device: this.device
    }
  };

  var deferred = Q.defer();
  var parameters = msg.parameters;
  var device;
  if (parameters.device.transport == 'winusb') {
    device = new winUSBDevice(parameters.device);
  }
  else
  if (parameters.device.transport == 'hid') {
    device = new hidDevice(parameters.device, hid);
  }
  boundDevices.push(device);
  var id = boundDevices.length - 1;
  device.open(function(result) {
    deferred.resolve({
      deviceId: id
    });
  });

  return deferred.promise.then(function(result) {
    currentDevice.id = result.deviceId;
  });
}

chromeDevice.prototype.send_async = function(data) {
  var msg = {
    parameters: {
      deviceId: this.id,
      data: data
    }
  };
  var deferred = Q.defer();
  var parameters = msg.parameters;
  var device = boundDevices[msg.parameters.deviceId]
  device.send(parameters.data, function(result) {
    deferred.resolve(result);
  });
  return deferred.promise;
}

chromeDevice.prototype.recv_async = function(size) {
  var msg = {
    parameters: {
      deviceId: this.id,
      size: size
    }
  };
  var deferred = Q.defer();
  var parameters = msg.parameters;
  var device = boundDevices[msg.parameters.deviceId]
  device.recv(parameters.size, function(result) {
    deferred.resolve(result);
  });
  return deferred.promise;
}

chromeDevice.prototype.close_async = function() {
  var msg = {
    parameters: {
      deviceId: this.id
    }
  };
  var deferred = Q.defer();

  var device = boundDevices[msg.parameters.deviceId];
  device.close(function() {
    deferred.resolve({});
  });
  return deferred.promise;
}


chromeDevice.enumerateDongles_async = function(pid) {
  var msg = {
    parameters: {
      vid: 0x2581,
      pid: pid || 0x1b7c
    }
  };

  var deferred = Q.defer();

  var vid = 0x2581;
  var pid = 0x1808;
  var parameters = msg.parameters;
  if (typeof parameters.vid != "undefined") {
    vid = parameters.vid;
  }
  if (typeof parameters.pid != "undefined") {
    pid = parameters.pid;
  }
  var vidHid = 0x2581;
  var pidHid = pid;
  var pidHid2 = pidHid;
  var pidHid3 = pidHid;
  var usagePage;
  var pidHidIsLedger = false;
  // Probe automatically the associated transport supposing the client used the WinUSB transport
  if (pid == 0x1808) {
    pidHid = 0x1807;
  }
  else
  if (pid == 0x1b7c) {
    pidHid = 0x2b7c; // LW Legacy - old
    pidHid2 = 0x3b7c; // LW Legacy - Ledger Protocol
    pidHid3 = 0x4b7c; // LW Proton
  } else if (pid === 0x0001) { // nano s
    pid = 0x1b7c; // don't try nano s vid with incorrect pid
    vidHid = 0x2c97;
    pidHid = 0x0001;
    pidHidIsLedger = true;
    pidHid2 = pidHid3 = 0x0000;
  }
  debug("Looking up " + vid +  " " + pid);

  winUSBDevice.enumerate(vid, pid, function(devicesWinUSB) {
    debug("WinUSB devices");
    debug(devicesWinUSB);
    hidDevice.enumerate(vidHid, pidHid, usagePage, pidHidIsLedger, function(devicesHID) {
      debug("HID devices");
      debug(devicesHID);
      hidDevice.enumerate(vidHid, pidHid2, usagePage, true, function(devicesHID2) {
        debug("HID devices 2");
        debug(devicesHID2);
	hidDevice.enumerate(vidHid, pidHid3, usagePage, true, function(devicesHID3) {
		debug("HID devices 3");
		debug(devicesHID3);
        	for (var i=0; i<devicesHID.length; i++) {
          		devicesWinUSB.push(devicesHID[i]);
        	}
        	if (pidHid2 != pidHid) {
          		for (var i=0; i<devicesHID2.length; i++) {
            			devicesWinUSB.push(devicesHID2[i]);
          		}
        	}
		if (pidHid3 != pidHid) {
			for (var i=0; i<devicesHID3.length; i++) {
				devicesWinUSB.push(devicesHID3[i]);
			}
		}
        	deferred.resolve({
          		deviceList: devicesWinUSB
        	});
      	});
      });
   });
  });

  return deferred.promise;
}

}
