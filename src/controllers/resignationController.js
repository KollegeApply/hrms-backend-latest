const { default: httpStatus } = require('http-status');
const Joi = require('joi');
const catchAsync = require('../utility/catchAsync');
const ApiError = require('../utility/ApiError');
const resignationService = require('../services/resignationService');

const applySchema = Joi.object({
  emailSubject: Joi.string().trim().min(1).max(300).required(),
  emailBody: Joi.string().trim().min(1).max(10000).required(),
  lastWorkingDay: Joi.date().required(),
  extraCc: Joi.array().items(Joi.string().trim().email()).default([]),
});

const tlActionSchema = Joi.object({
  action: Joi.string().valid('approved', 'rejected').required(),
  lastWorkingDay: Joi.when('action', {
    is: 'approved',
    then: Joi.date().required(),
    otherwise: Joi.any().strip(),
  }),
});

const hrActionSchema = Joi.object({
  action: Joi.string().valid('approved', 'rejected').required(),
});

const respond = (res, data, message = 'OK', code = httpStatus.OK) =>
  res.status(code).json({ status: true, message, data });

const verifyPassword = catchAsync(async (req, res) => {
  const ok = await resignationService.verifyPassword(req.user.id, req.body?.password);
  // Not 401: the frontend api client treats any 401 as an expired session and logs out.
  if (!ok) throw new ApiError(httpStatus.BAD_REQUEST, 'Incorrect password.');
  respond(res, { verified: true }, 'Password verified.');
});

const getConfig = catchAsync(async (req, res) => {
  respond(res, await resignationService.getApplyConfig(req.user.id, req.user.team));
});

const getCcUsers = catchAsync(async (req, res) => {
  respond(res, await resignationService.getCcUsers(req.user));
});

const apply = catchAsync(async (req, res) => {
  const payload = await applySchema.validateAsync(req.body);
  const data = await resignationService.applyResignation(req.user, payload);
  respond(res, data, 'Resignation submitted.', httpStatus.CREATED);
});

const getMine = catchAsync(async (req, res) => {
  respond(res, await resignationService.getMine(req.user.id));
});

const getTl = catchAsync(async (req, res) => {
  respond(res, await resignationService.getForTl(req.user));
});

const getHr = catchAsync(async (req, res) => {
  respond(res, await resignationService.getForHr());
});

const tlAction = catchAsync(async (req, res) => {
  const payload = await tlActionSchema.validateAsync(req.body);
  respond(res, await resignationService.tlAction(req.user, req.params.id, payload), 'Updated.');
});

const hrAction = catchAsync(async (req, res) => {
  const payload = await hrActionSchema.validateAsync(req.body);
  respond(res, await resignationService.hrAction(req.user, req.params.id, payload), 'Updated.');
});

module.exports = { verifyPassword, getConfig, getCcUsers, apply, getMine, getTl, getHr, tlAction, hrAction };
