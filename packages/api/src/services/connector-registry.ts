/**
 * Boot-validated connector manifest registry.
 *
 * Registration happens at module load, so a malformed or duplicate manifest
 * fails the process before it serves a request — the channel-plugin precedent.
 * Adding a provider means importing its manifest and adding it to this list;
 * nothing else in the core, routes, scopes, SDK or CLI changes (a fixture
 * manifest in the test suite plus a grep guard pins that).
 */

import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';

export const connectorRegistry = new ConnectorRegistry([clickupManifest]);

// Fails loudly if a manifest is malformed. Redundant with the constructor only
// in the sense that this is the explicit boot assertion the design requires.
connectorRegistry.assertValid();
