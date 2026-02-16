'use strict';

class AppError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

class ExternalServiceError extends AppError {
  constructor(service, message, details = {}) {
    super(`[${service}] ${message}`, 502, details);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

class VinValidationError extends AppError {
  constructor(message = 'Invalid VIN provided') {
    super(message, 400);
    this.name = 'VinValidationError';
  }
}

class ScenarioNotFoundError extends AppError {
  constructor(scenario) {
    super(`Unknown scenario: ${scenario}`, 400);
    this.name = 'ScenarioNotFoundError';
  }
}

module.exports = {
  AppError,
  ExternalServiceError,
  VinValidationError,
  ScenarioNotFoundError,
};
