# ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**provider_id** | **str** | Provider ID (template: {{instance.agentProviderId}}) | [optional] 
**agent_id** | **str** | Agent ID (required or template) | 
**agent_type** | **str** | Agent type | [optional] 
**session_strategy** | **str** | Session strategy for agent memory | [optional] 
**prefix_sender_name** | **bool** | Prefix messages with sender name | [optional] 
**timeout_ms** | **int** | Timeout in milliseconds | [optional] 
**response_as** | **str** | Store agent response as variable for chaining (e.g., \&quot;agentResponse\&quot;) | [optional] 

## Example

```python
from omni_generated.models.list_automations200_response_items_inner_actions_inner_any_of4_config import ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config

# TODO update the JSON string below
json = "{}"
# create an instance of ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config from a JSON string
list_automations200_response_items_inner_actions_inner_any_of4_config_instance = ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config.from_json(json)
# print the JSON string representation of the object
print(ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config.to_json())

# convert the object into a dict
list_automations200_response_items_inner_actions_inner_any_of4_config_dict = list_automations200_response_items_inner_actions_inner_any_of4_config_instance.to_dict()
# create an instance of ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config from a dict
list_automations200_response_items_inner_actions_inner_any_of4_config_from_dict = ListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config.from_dict(list_automations200_response_items_inner_actions_inner_any_of4_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


