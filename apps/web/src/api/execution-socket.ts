import { io, type Socket } from 'socket.io-client';

let socket: Socket | undefined;

/**
 * Conexão única com o namespace `/executions` (FR-012). O token vai no handshake; ao renovar,
 * a próxima reconexão usa o token novo.
 */
export function executionSocket(getToken: () => string | undefined): Socket {
  if (!socket) {
    socket = io('/executions', {
      path: '/socket.io',
      transports: ['websocket'],
      auth: (cb) => {
        cb({ token: getToken() });
      },
    });
  }
  return socket;
}
