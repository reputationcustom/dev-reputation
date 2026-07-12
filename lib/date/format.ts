import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { differenceInCalendarDays, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns";

// Fuso horário do usuário (CLAUDE.md, "Fuso horário do usuário"): datas são
// sempre armazenadas em UTC (timestamptz) — a conversão pro fuso de exibição
// acontece só aqui, no frontend, nunca no servidor. `useUserProfile()`
// (hooks/use-user-profile.ts) é quem resolve o fuso de cada usuário; este
// valor só serve de fallback antes do perfil carregar ou pra quem nunca
// configurou um fuso.
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/** Datas de transação: dd/MM/yyyy */
export function formatDate(date: Date | string, timezone: string = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(date, timezone, "dd/MM/yyyy");
}

/**
 * Reformata uma data "yyyy-MM-dd" pura (sem componente de hora — ex:
 * `period.start`/`period.end` do envelope, uma coluna `date` do Postgres,
 * não `timestamptz`) para `dd/MM/yyyy` via split de string, nunca via
 * `new Date(...)`/fuso horário — não há hora/fuso a converter aqui, e
 * tratar essa string como um instante (via `formatDate`) arriscaria um
 * bug de off-by-one dependendo de como o parser ISO interpreta a
 * ausência de 'Z' (mesma classe de bug que motivou toda a disciplina de
 * fuso deste arquivo).
 */
export function formatDateOnly(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Datas com hora: dd/MM/yyyy HH:mm */
export function formatDateTime(date: Date | string, timezone: string = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(date, timezone, "dd/MM/yyyy HH:mm");
}

/** Datas relativas: Hoje, Ontem, há N dias — usando o fuso do usuário como referência. */
export function formatRelativeDate(
  date: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const target = typeof date === "string" ? new Date(date) : date;
  const zonedTarget = toZonedTime(target, timezone);
  const zonedNow = toZonedTime(new Date(), timezone);
  const diffDays = differenceInCalendarDays(zonedNow, zonedTarget);

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays > 1) return `há ${diffDays} dias`;
  return formatDate(target, timezone);
}

/**
 * Início/fim de um mês (0 = mês atual, 1 = mês anterior, ...) calculados no
 * fuso do usuário e devolvidos como instantes UTC reais — prontos pra virar
 * filtro `gte`/`lte` contra uma coluna timestamptz. Nunca calcular esses
 * limites no fuso do servidor.
 */
export function getMonthRange(
  timezone: string = DEFAULT_TIMEZONE,
  monthsAgo = 0,
  reference: Date = new Date(),
): { start: Date; end: Date } {
  const zonedReference = toZonedTime(reference, timezone);
  const targetMonth = subMonths(zonedReference, monthsAgo);

  return {
    start: fromZonedTime(startOfMonth(targetMonth), timezone),
    end: fromZonedTime(endOfMonth(targetMonth), timezone),
  };
}

/**
 * Janela de N dias (inclusive, terminando "hoje" no fuso do usuário) como
 * datas planas `yyyy-MM-dd` — o formato que os `period.start`/`period.end`
 * do envelope (`aggregated-metrics/standard-json-envelope.md`) esperam
 * (colunas `date` no Postgres, não `timestamptz`). Usado pelo seletor de
 * período global (7/14/30 dias, `intelligence-center/executive-overview.md`,
 * "Header") — "hoje" é sempre calculado no fuso do usuário, nunca no fuso
 * do servidor, mesma disciplina de `getMonthRange`.
 */
export function getLastNDaysRange(
  days: number,
  timezone: string = DEFAULT_TIMEZONE,
  reference: Date = new Date(),
): { start: string; end: string } {
  const zonedToday = toZonedTime(reference, timezone);
  const zonedStart = subDays(zonedToday, days - 1);

  const pad = (n: number) => String(n).padStart(2, "0");
  const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return {
    start: toDateString(zonedStart),
    end: toDateString(zonedToday),
  };
}
