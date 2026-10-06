import { activeTraceIds, otelLogDestination, telemetryEnabled } from '@olly/telemetry';
import type { Params } from 'nestjs-pino';
import pino, { type DestinationStream } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';

/**
 * `pinoHttp` do nestjs-pino com a telemetria (spec 012, FR-003, plan §4): os ids do trace ativo
 * entram **depois** do mascaramento (spec 009), para não serem tratados como dados pessoais, e,
 * com a telemetria ligada, cada linha (já mascarada) também vai ao coletor como log OTel.
 */
export function pinoHttpWithTelemetry(
  options: PinoHttpOptions,
  stream?: DestinationStream,
): Params['pinoHttp'] {
  const mask = options.formatters?.log;
  const withIds: PinoHttpOptions = {
    ...options,
    formatters: {
      ...options.formatters,
      log: (object) => {
        const masked = mask ? mask(object) : object;
        const ids = activeTraceIds();
        return ids ? { ...masked, ...ids } : masked;
      },
    },
  };
  if (!telemetryEnabled()) return stream ? [withIds, stream] : withIds;
  // Os destinos não filtram: o nível do logger já decide o que sai.
  const destinations = pino.multistream([
    { level: 'trace', stream: stream ?? pino.destination(1) },
    { level: 'trace', stream: otelLogDestination() },
  ]);
  return [withIds, destinations];
}
