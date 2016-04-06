var gulp = require('gulp');

require('./assets');
require('./browserify');
require('./templates');
require('./watch');

// tasks for file types
gulp.task('css', []);
gulp.task('js', ['browserify']);

// build, watch, default
gulp.task('build', ['templates', 'css', 'js', 'assets']);
gulp.task('watch', ['build', 'listen']);
gulp.task('default', ['build', 'watch']);
