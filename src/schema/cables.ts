/**
 * A cable run's type id. In the connector-primary model this is simply the
 * connector id the cable terminates in (color/label/validation all resolve from
 * the connector — see `connectors.ts`). Kept as a string alias for serialization
 * stability and so older diagrams keep loading.
 */
export type CableTypeId = string;
