// expects an angular module
// attaches all of the services to it!

module.exports = Services;

// these are all the services exposed when this runs
// we would just iterate over the FS and include them all,
// however browserify wont find them automatically if we do that..
// it's easier to just maintain this list manually,
// also you can swap out implementations if you want based on runtime logic
var serviceMap = {
  crypto: require('./crypto'),
  focus: require('./focus'),
  notices: require('./notices')
};

function Services (module) {
  Object.keys(serviceMap).forEach(function (serviceName) {
    var service = serviceMap[serviceName];
    module.factory(
      serviceName,
      (service.dependencies || []).concat(service)
    );
  });
}
