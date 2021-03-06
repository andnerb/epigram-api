const Joi = require('joi');
const Boom = require('boom');
const fs = require('fs');
const response = require('../tools/response');

module.exports = (models) => {
  /**
   * @api {get} /api/v1/category/{category_id}/photos Get photo by category
   * @apiName GetPhotosDataByCategory
   * @apiGroup Photo
   * @apiVersion 1.0.0
   *
   * @apiParam {category_id} category_id The id of the category where to search for photos
   *
   * @apiHeader (Header fields required) {X-API-KEY} X-API-KEY The api token value [required]
   * @apiHeader (Header fields required) {Content-Type} Content-Type Must be application/json
   * @apiHeaderExample {header} X-API-KEY
   * X-API-KEY: your_token...
   * @apiHeaderExample {header} Content-Type
   * Content-Type: application/json
   *
   */
  const getPhotos = async (request, h) => {
    const result = [];

    const category = await models.category.findOne({
      where: {
        id: request.params.category_id,
      },
    });

    if (category === null) {
      throw Boom.notFound(`Category with id '${request.params.category_id}' does not exist`, null);
    }

    const photos = await models.photo.findAll({
      where: {
        category_id: request.params.category_id,
      },
      attributes: Object.keys(models.photo.attributes).concat([
        [models.sequelize.literal("(SELECT COUNT(*) FROM opinions WHERE opinions.photo_id = photo.id AND opinions.opinion = 'LIKE')"), 'total_likes'],
        [models.sequelize.literal("(SELECT COUNT(*) FROM opinions WHERE opinions.photo_id = photo.id AND opinions.opinion = 'DISLIKE')"), 'total_dislikes'],
      ]),
    });

    for (let idx = 0; idx < photos.length; idx += 1) {
      delete photos[idx].dataValues.file_path;
      photos[idx].dataValues.url = `/photo/${photos[idx].dataValues.id}`;

      result.push(photos[idx].dataValues);
    }

    return response.success_response(h, result, null, 200);
  };

  /**
   * @api {post} /api/v1/category/{category_id}/photo Add a photo to a category
   * @apiName AddPhotoToCategory
   * @apiGroup Photo
   * @apiVersion 1.0.0
   *
   * @apiDescription Warning: the file, title and description parameters
   * must be sent to the format multipart/form-data
   *
   * @apiParam {title} title The title of the photo
   * @apiParam {description} description The description associated with the photo
   * @apiParam {file} file The photo file (jpeg or png accepted)
   *
   * @apiHeader (Header fields required) {X-API-KEY} X-API-KEY The api token value [required]
   * @apiHeader (Header fields required) {Content-Type} Content-Type Must be application/json
   * @apiHeaderExample {header} X-API-KEY
   * X-API-KEY: your_token...
   * @apiHeaderExample {header} Content-Type
   * Content-Type: multipart/form-data
   *
   */
  const addPhoto = async (request, h) => {
    const category = await models.category.findOne({
      where: {
        id: request.params.category_id,
      },
    });

    if (category === null) {
      throw Boom.notFound(`Category with id '${request.params.category_id}' does not exist`, null);
    }

    if (!request.payload.file) {
      throw Boom.badRequest('You must provide a file in the request');
    }

    const photo = await models.photo.create({
      title: request.payload.title,
      description: request.payload.description,
      file_path: null,
      category_id: request.params.category_id,
      user_id: request.auth.credentials.user.id,
      mime_type: request.payload.file.hapi.headers['content-type'],
    });

    if (process.env.WRITE_DIR) {
      await photo.updateAttributes({
        file_path: `${process.env.WRITE_DIR}/${photo.dataValues.id}.jpg`,
      });
    } else {
      await photo.updateAttributes({
        file_path: `file_vault/${photo.dataValues.id}.jpg`,
      });
    }

    // Read uploaded file stream and put it to a buffer
    let chunk;
    const bufferss = [];
    while (chunk !== null) {
      chunk = request.payload.file.read();
      if (chunk === null) break;
      bufferss.push(chunk);
    }
    const buffer = Buffer.concat(bufferss);

    // Save buffer to disk
    if (process.env.WRITE_DIR) {
      fs.writeFileSync(`${process.env.WRITE_DIR}/${photo.dataValues.id}.jpg`, buffer);
    } else {
      fs.writeFileSync(`file_vault/${photo.dataValues.id}.jpg`, buffer);
    }

    delete photo.dataValues.file_path;
    photo.dataValues.url = `/photo/${photo.dataValues.id}`;
    photo.dataValues.belongToUser = (photo.dataValues.user_id === request.auth.credentials.user.id);

    return response.success_response(h, photo.dataValues, null, 201);
  };

  /**
   * @api {get} /api/v1/photo/{id} Get the picture in itself
   * @apiName GetPhotoFile
   * @apiGroup Photo
   * @apiVersion 1.0.0
   *
   * @apiDescription This call is used to get and display a photo
   * from the photo url provided while searching photos by categories
   *
   * @apiParam {id} id The id of the photo
   *
   * @apiHeader (Header fields required) {X-API-KEY} X-API-KEY The api token value [required]
   * @apiHeader (Header fields required) {Content-Type} Content-Type Must be multipart/form-data
   * @apiHeaderExample {header} X-API-KEY
   * X-API-KEY: your_token...
   * @apiHeaderExample {header} Content-Type
   * Content-Type: application/json
   *
   */
  const readPhoto = async (request, h) => {
    const photo = await models.photo.findOne({
      where: {
        id: request.params.id,
      },
    });

    if (photo === null) {
      throw Boom.notFound(`Photo with id '${request.params.id}' does not exist`, null);
    }

    let file = null;
    try {
      file = fs.readFileSync(photo.dataValues.file_path);
    } catch (exception) {
      if (exception.code === 'ENOENT') throw Boom.resourceGone(`Photo with id ${photo.dataValues.id} exist but corresponding file could not be found`);
      else {
        global.console.err(exception);
        throw Boom.internal(`Photo with id ${photo.dataValues.id} exist but file could not be read`);
      }
    }

    return h.response(file).type(photo.mime_type).code(200);
  };

  /**
   * @api {delete} /api/v1/photo/{id} Delete the photo
   * @apiName DeletePhoto
   * @apiGroup Photo
   * @apiVersion 1.0.0
   *
   * @apiParam {id} category_id The id of the category where to search for photos
   *
   * @apiHeader (Header fields required) {X-API-KEY} X-API-KEY The api token value [required]
   * @apiHeader (Header fields required) {Content-Type} Content-Type Must be application/json
   * @apiHeaderExample {header} X-API-KEY
   * X-API-KEY: your_token...
   * @apiHeaderExample {header} Content-Type
   * Content-Type: application/json
   *
   */
  const delPhoto = async (request, h) => {
    const photo = await models.photo.findOne({
      where: {
        id: request.params.id,
      },
    });

    if (photo === null) {
      throw Boom.notFound(`Photo with id '${request.params.category_id}' does not exist`, null);
    }

    await Promise.all([models.opinion.destroy({
      where: {
        photo_id: request.params.id,
      },
    }),
    models.comment.destroy({
      where: {
        photo_id: request.params.id,
      },
    })]);

    await models.photo.destroy({
      where: {
        id: request.params.id,
      },
    });

    return response.success_response(h, null, 'Photo and associated ressources deleted', 202);
  };

  /**
   * @api {get} /api/v1/photo/{photo_id}/info Get single photo info
   * @apiName GetPhotoData
   * @apiGroup Photo
   * @apiVersion 1.0.0
   *
   * @apiParam {photo_id} photo_id The id of the photo
   *
   * @apiHeader (Header fields required) {X-API-KEY} X-API-KEY The api token value [required]
   * @apiHeader (Header fields required) {Content-Type} Content-Type Must be application/json
   * @apiHeaderExample {header} X-API-KEY
   * X-API-KEY: your_token...
   * @apiHeaderExample {header} Content-Type
   * Content-Type: application/json
   *
   */
  const getPhotoInfo = async (request, h) => {
    const photo = await models.photo.findOne({
      where: {
        id: request.params.photo_id,
      },
      attributes: Object.keys(models.photo.attributes).concat([
        [models.sequelize.literal("(SELECT COUNT(*) FROM opinions WHERE opinions.photo_id = photo.id AND opinions.opinion = 'LIKE')"), 'total_likes'],
        [models.sequelize.literal("(SELECT COUNT(*) FROM opinions WHERE opinions.photo_id = photo.id AND opinions.opinion = 'DISLIKE')"), 'total_dislikes'],
      ]),
    });

    if (photo === null) {
      throw Boom.notFound(`Photo with id '${request.params.photo_id}' does not exist`, null);
    }

    delete photo.dataValues.file_path;
    photo.dataValues.url = `/photo/${photo.dataValues.id}`;
    photo.dataValues.belongToUser = (photo.dataValues.user_id === request.auth.credentials.user.id);

    return response.success_response(h, photo.dataValues, null, 200);
  };

  return [
    {
      method: 'GET',
      path: '/category/{category_id}/photos',
      handler: getPhotos,
      options: {
        auth: 'default',
        validate: {
          params: {
            category_id: Joi.number().integer().required(),
          },
        },
      },
    },
    {
      method: 'GET',
      path: '/photo/{photo_id}/info',
      handler: getPhotoInfo,
      options: {
        auth: 'default',
        validate: {
          params: {
            photo_id: Joi.number().integer().required(),
          },
        },
      },
    },
    {
      method: 'GET',
      path: '/photo/{id}',
      handler: readPhoto,
      options: {
        validate: {
          params: {
            id: Joi.number().integer().required(),
          },
        },
      },
    },
    {
      method: 'DELETE',
      path: '/photo/{id}',
      handler: delPhoto,
      options: {
        auth: 'default',
        validate: {
          params: {
            id: Joi.number().integer().required(),
          },
        },
      },
    },
    {
      method: 'POST',
      path: '/category/{category_id}/photo',
      handler: addPhoto,
      options: {
        auth: 'default',
        payload: {
          output: 'stream',
          parse: true,
          allow: 'multipart/form-data',
          maxBytes: 10 * 1024 * 1024, // max 10 Mo
        },
        validate: {
          params: {
            category_id: Joi.number().integer().required(),
          },
          payload: {
            title: Joi.string().max(255).required(),
            description: Joi.string().required(),
            file: Joi.object({
              hapi: Joi.object({
                headers: Joi.object({
                  'content-type': Joi.string().valid(['image/jpeg', 'image/png']).required(),
                }).unknown(),
              }).unknown(),
            }).unknown(),
          },
        },
      },
    },
  ];
};
