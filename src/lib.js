const path = require('path')
const {readFileSync, existsSync, statSync, createReadStream} = require('fs')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const slugify = require('node-slugify')
const csv = require('fast-csv')
const hbs = require('handlebars')
const download = require('download')
const crypto = require('crypto')
const logger = require('./logger')
const message = require('./messages')
const compiler = require('./compiler')

const cwd = process.cwd()

const isFileExists = (...files) => {
  return existsSync(path.join(...files)) && statSync(path.join(...files)).isFile()
}

const isDirExists = (...dirs) => {
  return existsSync(path.join(...dirs)) && statSync(path.join(...dirs)).isDirectory()
}

exports.new = args => {
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
      srcDir: path.join(__dirname, 'templates'),
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

exports.build = (args, options) => {
  if (!isFileExists(cwd, 'project.json') &&
    !isDirExists(cwd, 'csv') &&
    !isDirExists(cwd, 'dist') &&
    !isDirExists(cwd, 'hooks') &&
    !isDirExists(cwd, 'pages') &&
    !isDirExists(cwd, 'themes')) {
    logger.error(message.NOT_IN_PROJECT_FOLDER)
  }

  const project = require(path.join(cwd, 'project.json'))
  const csvDir = path.join(cwd, 'csv')

  let csvList = []

  if (!args.csvFile) {
    csvList = compiler.scandir(csvDir).filter(item => {
      return path.extname(item) === '.csv'
    })
  } else {
    if (isFileExists(cwd, 'csv', `${args.csvFile}.csv`)) {
      csvList.push(`${args.csvFile}.csv`)
    }
  }

  if (csvList.length === 0) {
    logger.error(message.NO_CSV_FILE)
  }

  const data = []
  const build = async () => {
    const loader = logger.loader(message.BUILD_LOADING)
    let _data = await data

    const _themepath = path.join(cwd, 'themes', project.settings.theme)
    const _distpath = path.join(cwd, 'dist')
    if (options.clean) {
      rimraf.sync(path.join(_distpath, '*'))
    }

    const _uploadpath = path.join(_distpath, project.settings.slug.upload)
    mkdirp.sync(_uploadpath)

    const _itempath = path.join(_distpath, project.settings.slug.item)
    mkdirp.sync(_itempath)

    // Default build hooks.
    let _buildHooks = {
      pre: data => data,
      post: data => data,
      each: item => item
    }

    if (isFileExists(cwd, 'hooks', 'build.js')) {
      _buildHooks = require(path.join(cwd, 'hooks', 'build'))
    }

    // Apply pre build hooks.
    if (typeof _buildHooks.pre === 'function') {
      _data = _buildHooks.pre(_data)
    }

    // Register custom handlebars helper
    let _helpers = {
      slugify
    }

    if (isFileExists(cwd, 'hooks', 'helpers.js')) {
      _helpers = Object.assign(_helpers, require(path.join(cwd, 'hooks', 'helpers')))
    }

    for (const name in _helpers) {
      if (Object.prototype.hasOwnProperty.call(_helpers, name)) {
        hbs.registerHelper(name, _helpers[name])
      }
    }

    // Downloader hooks
    let _downloader = {
      pre: url => url,
      post: file => file
    }
    if (isFileExists(cwd, 'hooks', 'downloader.js')) {
      _downloader = Object.assign(_downloader, require(path.join(cwd, 'hooks', 'downloader')))
    }

    // Register default partial template.
    // header, footer, etc.
    const templates = {
      header: '',
      footer: ''
    }

    const headerHbs = [_themepath, 'header.hbs']
    if (isFileExists(...headerHbs)) {
      templates.header = readFileSync(path.join(...headerHbs), 'utf-8')
    }

    const footerHbs = [_themepath, 'footer.hbs']
    if (isFileExists(...footerHbs)) {
      templates.footer = readFileSync(path.join(...footerHbs), 'utf-8')
    }

    hbs.registerPartial('header', templates.header)
    hbs.registerPartial('footer', templates.footer)

    // Syntax builder.
    const syntax = (template, data = {}) => {
      const {site, meta, settings} = project
      const syntaxData = Object.assign({
        site,
        meta,
        settings,
        is: {
          home: false,
          item: false,
          page: false
        }
      }, data)

      // Make copy of template
      const _template = Object.assign({}, template)

      for (const i in _template) {
        if (Object.prototype.hasOwnProperty.call(_template, i)) {
          const _compiler = hbs.compile(_template[i])
          _template[i] = _compiler(syntaxData)
        }
      }

      const finalSyntax = Object.assign(syntaxData, _template)

      if (finalSyntax.slug) {
        finalSyntax.slug = slugify(finalSyntax.slug)
      }

      return finalSyntax
    }

    // Compile assets.
    const assets = [_themepath, 'assets']
    if (isDirExists(...assets)) {
      compiler.bulk({
        srcDir: path.join(...assets),
        dstDir: path.join(_distpath, 'assets')
      })
    }

    // Compile homepage.
    const homeHbs = [_themepath, 'home.hbs']
    const indexHtml = path.join(_distpath, 'index.html')
    if (isFileExists(...homeHbs) && (!isFileExists(indexHtml) || options.overwrite)) {
      compiler.single({
        srcPath: path.join(...homeHbs),
        dstPath: indexHtml,
        syntax: syntax(project.meta.home, {
          is: {
            home: true
          }
        })
      })
    }

    // Compile pages.
    const pageHbs = [_themepath, 'page.hbs']
    if (isFileExists(...pageHbs)) {
      const pages = compiler.scandir(path.join(cwd, 'pages'))
      pages.forEach(item => {
        const pageExt = path.extname(item)
        const pageName = path.basename(item, pageExt)
        const pageHtml = path.join(_distpath, `${pageName}.html`)

        if (pageName in project.meta.pages && pageExt === '.hbs' && (!isFileExists(pageHtml) || options.overwrite)) {
          compiler.single({
            srcPath: path.join(...pageHbs),
            dstPath: pageHtml,
            syntax: syntax(project.meta.pages[pageName], {
              page: Object.assign({
                content: readFileSync(path.join(cwd, 'pages', item))
              }, project.meta.pages[pageName]),
              is: {
                page: true
              }
            })
          })
        }
      })
    }

    // Compile items.
    const itemHbs = [_themepath, 'item.hbs']
    const iterateItems = data.map((item, index) => {
      new Promise(async resolve => {
        let _item = item.item

        if (isFileExists(...itemHbs)) {
          // Apply each build item hooks.
          if (typeof _buildHooks.each === 'function') {
            _item = _buildHooks.each(_item)
          }

          const _syntax = syntax(project.meta.item, {
            item: _item,
            is: {
              item: true
            }
          })

          let slug = _syntax.slug || index
          const dstPath = path.join(_itempath, `${slug}.html`)

          // Download image.
          let downloadImg = () => new Promise(resolve => {
            resolve()
          })

          const {saveimg, imgcolumn} = project.settings.data

          if (saveimg && imgcolumn in _item) {
            const hash = crypto.createHash('md5').update(_item[imgcolumn]).digest('hex')
            const imgext = path.extname(_item[imgcolumn])
            const imgname = `${slug}-${hash}${imgext}`

            if (!isFileExists(path.join(_uploadpath, imgname)) || options.overwrite) {
              downloadImg = () => new Promise(resolve => {
                // Apply predownload hooks.
                const imgurl = _downloader.pre(_item[imgcolumn])

                download(imgurl, _uploadpath, {
                  filename: imgname
                }).then(() => {
                  _item[imgcolumn] = imgname

                  // Apply post-download hooks.
                  _downloader.post(path.join(_uploadpath, imgname))
                  resolve()
                }).catch(logger.error)
              })
            }
          }

          if (!existsSync(dstPath) || options.overwrite) {
            await downloadImg().then(() => {
              loader.frame()
              loader.text = `Compiling ${item.filename} #${index}`

              compiler.single({
                srcPath: path.join(...itemHbs),
                dstPath,
                syntax: Object.assign(_syntax, {
                  item: _item
                })
              })
              resolve()
            }).catch(logger.error)
          }
        }
      }).catch(logger.error)
    })

    // Build items.
    Promise.all(iterateItems).then(() => {
      // Apply after build hoks.
      if (typeof _buildHooks.post === 'function') {
        _buildHooks.post(_data)
      }

      setTimeout(() => {
        loader.stop()
        logger.success(message.DONE)
      }, 1000)
    }).catch(logger.error)
  }

  const buildParallel = filename => new Promise(resolve => {
    csv
      .fromStream(createReadStream(path.join(cwd, 'csv', filename)), {headers : true})
      .on('data', item => data.push({filename, item}))
      .on('end', resolve)
  })

  Promise.all(csvList.map(buildParallel)).then(build).catch(logger.error)
}
