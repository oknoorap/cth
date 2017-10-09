const path = require('path')
const {readFileSync, existsSync, statSync, createReadStream} = require('fs')
const crypto = require('crypto')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const slugify = require('node-slugify')
const csv = require('fast-csv')
const hbs = require('handlebars')
const download = require('download')
const moment = require('moment')
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

  /* eslint-disable no-lonely-if */
  if (args.csvFile === undefined) {
    csvList = compiler.scandir(csvDir).filter(item => {
      return path.extname(item) === '.csv'
    })
  } else {
    if (isFileExists(cwd, 'csv', `${args.csvFile}.csv`)) {
      csvList.push(`${args.csvFile}.csv`)
    } else {
      logger.error(message.INVALID_CSV_FILE)
    }
  }
  /* eslint-enable no-lonely-if */

  if (csvList.length === 0) {
    logger.error(message.NO_CSV_FILE)
  }

  let data = []
  const parsingCSV = Promise.all(csvList.map(
    filename => new Promise(resolve => {
      csv
        .fromStream(createReadStream(path.join(cwd, 'csv', filename)), {headers: true})
        .on('data', items => data.push({filename, items}))
        .on('end', resolve)
    })
  ))

  const build = () => {
    const loader = logger.loader(message.BUILD_LOADING)
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
      data = _buildHooks.pre(data)
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
      post: () => new Promise(resolve => resolve)
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
          page: false,
          sitemap: true,
          imgdownloaded: false
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

    // Compile robots.txt
    const robotsTxtSrc = [_themepath, 'robots.txt']
    const robotsTxt = path.join(_distpath, 'robots.txt')
    if (project.settings.robots && (!isFileExists(robotsTxt) || options.overwrite)) {
      compiler.single({
        srcPath: path.join(...robotsTxtSrc),
        dstPath: robotsTxt,
        syntax: syntax()
      })
    }

    // Compile pages.
    const pageHbs = [_themepath, 'page.hbs']
    const pages = compiler.scandir(path.join(cwd, 'pages'))
    if (isFileExists(...pageHbs)) {
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
      return new Promise(async resolve => {
        let _item = item.items

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

          const slug = _syntax.slug || index
          const dstPath = path.join(_itempath, `${slug}.html`)

          // Download image.
          let downloadImg = (() => new Promise(resolve => {
            resolve()
          }))()

          const {saveimg, imgcolumn} = project.settings.data

          if (saveimg && imgcolumn in _item) {
            const hash = crypto.createHash('md5').update(_item[imgcolumn]).digest('hex')
            const imgext = path.extname(_item[imgcolumn])
            const imgname = `${slug}-${hash}${imgext}`

            // Apply predownload hooks.
            const imgurl = _downloader.pre(_item[imgcolumn])
            _item[imgcolumn] = imgurl

            if ((imgurl && !isFileExists(path.join(_uploadpath, imgname))) || options.overwrite) {
              downloadImg = (() => new Promise(async resolve => {
                await download(imgurl, _uploadpath, {
                  filename: imgname
                }).then(() => {
                  _item[imgcolumn] = path.join('..', project.settings.slug.upload, imgname)
                  _syntax.is.imgdownloaded = true

                  // Apply post-download hooks.
                  const _imgpath = path.join(_uploadpath, imgname)
                  if (existsSync(_imgpath)) {
                    _downloader.post(path.join(_uploadpath, imgname)).then(() => {
                      resolve()
                    }).catch(logger.error)
                  } else {
                    resolve()
                  }
                }).catch(resolve)
              }))()
            }
          }

          if (!existsSync(dstPath) || options.overwrite) {
            await downloadImg.then(async () => {
              if (project.settings.data.multiple) {
                loader.frame()
                loader.text = `Compiling ${item.filename} #${index}`

                compiler.single({
                  srcPath: path.join(...itemHbs),
                  dstPath,
                  syntax: Object.assign(_syntax, {
                    items: [_item]
                  })
                })
              }
              resolve(_item)
            }).catch(logger.error)
          }
        }
      })
    })

    // Build items.
    const buildItems = Promise.all(iterateItems)

    // Build multiple items.
    const buildMultipleItems = new Promise(async resolve => {
      await buildItems.then(items => {
        if (project.settings.data.multiple) {
          return resolve()
        }

        let title = 'Untitled'
        items.forEach(item => {
          if (item.title) {
            title = item.title
          }
        })

        const slug = slugify(title)
        const dstPath = path.join(_itempath, `${slug}.html`)

        if (isFileExists(...itemHbs) && (!existsSync(dstPath) || options.overwrite)) {
          compiler.single({
            srcPath: path.join(...itemHbs),
            dstPath,
            syntax: syntax(project.meta.item, {
              items,
              is: {
                item: true
              }
            })
          })
        }

        resolve()
      }).catch(logger.error)
    })

    // Apply after build hooks.
    const buildPostHook = new Promise(async resolve => {
      await buildMultipleItems.then(() => {
        if (typeof _buildHooks.post === 'function') {
          _buildHooks.post(data)
        }
        resolve()
      }).catch(logger.error)
    })

    // Build sitemap.
    const buildSitemap = new Promise(async resolve => {
      const sitemaps = []
      const compileSitemap = () => {
        if (!project.settings.sitemap) {
          return resolve()
        }

        // Add pages.
        for (const page in project.meta.pages) {
          if (Object.prototype.hasOwnProperty.call(project.meta.pages, page)) {
            const _pagepath = path.join(_distpath, page)
            const _time = moment(new Date(statSync(`${_pagepath}.html`).mtime))
            sitemaps.push({
              url: `${project.site.url}/${page}.html`,
              lastmod: _time.format('YYYY-MM-DD')
            })
          }
        }

        // Add items.
        const items = compiler.scandir(_itempath)
        items.forEach(item => {
          const _time = moment(new Date(statSync(path.join(_itempath, item)).mtime))
          sitemaps.push({
            url: `${project.site.url}/${project.settings.slug.item}/${item}`,
            lastmod: _time.format('YYYY-MM-DD')
          })
        })

        // Build sitemap.xml
        const sitemapHbs = [_themepath, 'sitemap.hbs']
        const sitemapXML = path.join(_distpath, 'sitemap.xml')
        if (isFileExists(...sitemapHbs) && (!isFileExists(sitemapXML) || options.overwrite)) {
          compiler.single({
            srcPath: path.join(...sitemapHbs),
            dstPath: sitemapXML,
            syntax: syntax({}, {
              sitemaps,
              is: {
                sitemap: true
              }
            })
          })
        }

        // Copy xsl.
        const sitemapXSLSrc = [_themepath, 'sitemap.xsl']
        const sitemapXSLDst = path.join(_distpath, 'sitemap.xsl')
        if (isFileExists(...sitemapXSLSrc) && (!isFileExists(sitemapXSLDst) || options.overwrite)) {
          compiler.single({
            srcPath: path.join(...sitemapXSLSrc),
            dstPath: sitemapXSLDst,
            syntax: syntax({}, {
              is: {
                sitemap: true
              }
            })
          })
        }
        resolve()
      }

      await buildPostHook.then(compileSitemap).catch(logger.error)
    })

    // Finish.
    const stopLoader = () => {
      loader.stop()
      logger.success(message.DONE)
    }
    (async () => {
      await buildSitemap.then(setTimeout(stopLoader, 1000)).catch(logger.error)
    })()
  }

  // Compile all.
  (async () => {
    await parsingCSV.then(build).catch(logger.error)
  })()
}
