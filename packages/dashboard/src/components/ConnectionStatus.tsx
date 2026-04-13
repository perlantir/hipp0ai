interface ConnectionStatusProps {
  status: 'connected' | 'disconnected' | 'reconnecting';
}

const statusConfig = {
  connected: { color: '#16A34A', label: 'Connected' },
  disconnected: { color: '#DC2626', label: 'Disconnected' },
  reconnecting: { color: '#EAB308', label: 'Reconnecting' },
} as const;

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const { color, label } = statusConfig[status];

  return (
    <div className="connection-status" title={`WebSocket: ${label}`}>
      <span
        className="connection-dot"
        style={{ background: color }}
      />
      <span className="connection-label">{label}</span>
    </div>
  );
}
