# v52-mcp

Servidor MCP y gateway de herramientas de Vector52. **Scaffold documental; implementación pendiente.**

## Objetivo P0

- publicar tools de lectura y una operación `claim_audit` pagada;
- reutilizar la API/Core de `v52`, sin duplicar cálculos forenses;
- devolver evidencia, límites y estados tipados;
- coordinar el desafío x402 con la infraestructura de Saúl;
- soportar idempotencia y evitar doble cobro.

## Interfaz con la PWA

Omar y Jhamil construirán en `v52` la vista Agent Access. Este repositorio debe entregar schemas versionados y un cliente de referencia; la PWA no almacenará credenciales de agentes ni llaves privadas.

## Evidencia mínima para marcarlo funcional

- `tools/list` desde un cliente real;
- llamada gratuita reproducible;
- `claim_audit` devuelve payment required;
- pago válido crea un solo job;
- resultado cita IDs de evidencia;
- replay no genera otro cobro.
