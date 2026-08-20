interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  let bgColor = "bg-gray-100 text-gray-800";
  let dotColor = "bg-gray-400";
  let label = status;

  switch (status) {
    case "OPERACIONAL":
    case "CONNECTED":
    case "AUTO":
      bgColor = "bg-green-100 text-green-800 border-green-200";
      dotColor = "bg-green-500";
      label =
        status === "CONNECTED"
          ? "CONECTADO"
          : status === "AUTO"
            ? "AUTOMÁTICO"
            : status;
      break;
    case "DRY_RUN":
    case "MANUAL":
    case "NEEDS_REAUTH":
      bgColor = "bg-yellow-100 text-yellow-800 border-yellow-200";
      dotColor = "bg-yellow-500";
      label =
        status === "NEEDS_REAUTH"
          ? "REAUTENTICAÇÃO NECESSÁRIA"
          : status === "DRY_RUN"
            ? "SIMULAÇÃO"
            : status;
      break;
    case "PAUSADO":
    case "OFF":
      bgColor = "bg-gray-100 text-gray-800 border-gray-200";
      dotColor = "bg-gray-500";
      label = status === "OFF" ? "DESATIVADO" : status;
      break;
    case "NÃO CONECTADO":
    case "AGUARDANDO CONFIGURAÇÃO":
      bgColor = "bg-blue-100 text-blue-800 border-blue-200";
      dotColor = "bg-blue-500";
      break;
    case "INDISPONÍVEL":
    case "ERRO":
    case "DISCONNECTED":
      bgColor = "bg-red-100 text-red-800 border-red-200";
      dotColor = "bg-red-500";
      label = status === "DISCONNECTED" ? "DESCONECTADO" : status;
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${bgColor}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColor}`}></span>
      {label}
    </span>
  );
}
