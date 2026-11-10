import { describe, expect, test } from 'bun:test';
import { openApiSpec } from '../routes/openapi';

interface SchemaObject {
  $ref?: string;
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
}

const SECRET_FIELDS = ['zenviaApiToken', 'zenviaSalesApiKey', 'webhookVerifyToken'];
const PLAIN_FIELDS = [
  'zenviaSenderId',
  'zenviaHandoffSolution',
  'zenviaHandoffGroupId',
  'zenviaHandoffUserId',
  'zenviaHandoffRouting',
];
const ZENVIA_FIELDS = [...SECRET_FIELDS, ...PLAIN_FIELDS];

function component(name: string): SchemaObject {
  const schemas = (openApiSpec.components?.schemas ?? {}) as Record<string, SchemaObject>;
  const found = schemas[name];
  if (!found) throw new Error(`${name} is missing from the OpenAPI document`);
  return found;
}

function updateBody(): SchemaObject {
  const paths = openApiSpec.paths as Record<string, Record<string, unknown>>;
  const patch = paths['/instances/{id}']?.patch as
    | { requestBody?: { content?: Record<string, { schema?: SchemaObject }> } }
    | undefined;
  const schema = patch?.requestBody?.content?.['application/json']?.schema;
  if (!schema) throw new Error('PATCH /instances/{id} has no JSON body schema');
  return schema.$ref ? component(schema.$ref.split('/').pop() as string) : schema;
}

function props(schema: SchemaObject): Record<string, Record<string, unknown>> {
  return schema.properties ?? {};
}

describe('OpenAPI documents the Zenvia instance configuration', () => {
  test('create documents every Zenvia field, nullable like the route accepts them', () => {
    const properties = props(component('CreateInstanceRequest'));
    for (const field of ZENVIA_FIELDS) {
      expect(properties).toHaveProperty(field);
      expect(properties[field]?.nullable).toBe(true);
    }
  });

  test('update documents every Zenvia field and requires none of them', () => {
    const body = updateBody();
    for (const field of ZENVIA_FIELDS) {
      expect(props(body)).toHaveProperty(field);
      expect(body.required ?? []).not.toContain(field);
    }
  });

  test('connect documents every Zenvia field, optional and not nullable', () => {
    const connect = component('ConnectInstanceRequest');
    for (const field of ZENVIA_FIELDS) {
      expect(props(connect)).toHaveProperty(field);
      expect(props(connect)[field]?.nullable).not.toBe(true);
      expect(connect.required ?? []).not.toContain(field);
    }
  });

  test('the three secrets are write-only on create, update and connect', () => {
    for (const body of [component('CreateInstanceRequest'), updateBody(), component('ConnectInstanceRequest')]) {
      for (const field of SECRET_FIELDS) {
        expect(props(body)[field]).toMatchObject({ writeOnly: true });
      }
      for (const field of PLAIN_FIELDS) {
        expect(props(body)[field]?.writeOnly).toBeUndefined();
      }
    }
  });

  test('the instance response carries the plain fields and never a secret', () => {
    const response = props(component('Instance'));
    for (const field of PLAIN_FIELDS) expect(response).toHaveProperty(field);
    for (const field of SECRET_FIELDS) expect(response).not.toHaveProperty(field);
  });

  test('the handoff solution lists the three solutions and the routing map documents its shape', () => {
    for (const body of [component('CreateInstanceRequest'), updateBody(), component('ConnectInstanceRequest')]) {
      expect([...((props(body).zenviaHandoffSolution?.enum as string[] | undefined) ?? [])].sort()).toEqual([
        'conversion',
        'nlu',
        'zenvia_chat',
      ]);
      const routing = props(body).zenviaHandoffRouting as SchemaObject | undefined;
      expect(Object.keys(props(routing ?? {})).sort()).toEqual(['field', 'groups']);
    }
  });

  test('every Zenvia field carries a description', () => {
    for (const body of [component('CreateInstanceRequest'), component('ConnectInstanceRequest')]) {
      for (const field of ZENVIA_FIELDS) {
        expect(String(props(body)[field]?.description ?? '').length).toBeGreaterThan(0);
      }
    }
  });
});
