var gulp = require('gulp');

require('./assets');
require('./browserify');
require('./css');
require('./templates');
require('./watch');

// tasks for file types
gulp.task('css', gulp.series('build-css'));
gulp.task('js', gulp.series('browserify'));

// build, watch, default
gulp.task('build', gulp.series('css', 'js', 'assets'));
gulp.task('watch', gulp.series('build', 'listen'));
gulp.task('default', gulp.series('build', 'watch'));
