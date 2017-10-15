const path = require('path')
const slugify = require('node-slugify')
const mkdirp = require('mkdirp')
const message = require('../messages')
const logger = require('../logger')
const compiler = require('../compiler')
const {isFileExists, isDirExists} = require('../helpers')

module.exports = args => {
  const cwd = process.cwd()
  const projectName = slugify(args.projectName)
  const projectDir = path.join(cwd, projectName)

  if (!args.projectName) {
    logger.error(message.PROJECT_NAME_UNAVAILABLE)
  }

  if (isDirExists(projectDir)) {
    logger.error(`'${projectName}' ${message.FOLDER_ALREADY_EXISTS}`)
  }

  if (isFileExists(cwd, 'project.json') &&
    isDirExists(cwd, 'csv') &&
    isDirExists(cwd, 'dist') &&
    isDirExists(cwd, 'hooks') &&
    isDirExists(cwd, 'pages') &&
    isDirExists(cwd, 'themes')) {
    logger.error(message.FOLDER_ALREADY_INIT)
  }

  mkdirp(projectDir, err => {
    if (err) {
      logger.error(err)
    }

    compiler.bulk({
      srcDir: path.join(__dirname, '..', 'templates'),
      dstDir: projectDir,
      excludes: [
        'csv/.gitkeep',
        'dist/.gitkeep',
        'themes/multiverse/images/.gitkeep',
        'themes/multiverse/js/.gitkeep'
      ]
    })

    logger.success(message.SUCCEED_INIT)
    logger.info(`${message.BUILD_HTML}, type:`)
    logger.blank(`cd {${projectName}}\n`, '{cth build}')
  })
}
