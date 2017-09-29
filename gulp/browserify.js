var fs = require('fs');
var gulp = require('gulp');
var merge = require('merge-stream');
var browserify = require('browserify');
var clean = require('gulp-clean');
var source = require('vinyl-source-stream');

gulp.task('clean-js', function () {
  return gulp.src(['build/static/js/'], {read: false})
    .pipe(clean());
});

gulp.task('browserify', ['clean-js'], function () {
  // Single entry point to browserify
  var browserified = browserify('static/js/index.js', {
    insertGlobals: true
  }).external('ws')
    .external('node-hid')
    .external('electron');
  if (fs.existsSync('../plugins/cordova-plugin-wally/wally.js')) {
    // Cordova only
    browserified = browserified.require('../plugins/cordova-plugin-wally/wally', {expose: 'wallyjs'});
  } else {
    browserified = browserified.external('wallyjs');
  }
  browserified = browserified.bundle()
    .pipe(source('index.js'))
    .pipe(gulp.dest('build/static/js/'));

  var external = gulp.src('static/external/**/*')
    .pipe(gulp.dest('build/static/js/'));

  var mnonic = gulp.src(['static/js/greenwallet/mnemonics/**/*'])
    .pipe(gulp.dest('build/static/js/greenwallet/mnemonics/'));

  var signupWorker = gulp.src(['static/js/greenwallet/signup/**/*'])
    .pipe(gulp.dest('build/static/js/greenwallet/signup/'));

  return merge(browserified, external, mnonic, signupWorker);
});
