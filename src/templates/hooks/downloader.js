/**
 * Image downloader hooks, before and after downloading image.
 * You can manipulate file after image download.
 */

/**
 * Before download image.
 */
exports.pre = url => {
  return url
}

/**
 * After images downloaded to `settings.slug.uploads` directory.
 */
exports.post = file => {
  return file
}
