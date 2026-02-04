# ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** | Webhook URL | 
**method** | **str** |  | [optional] [default to 'POST']
**headers** | **Dict[str, str]** |  | [optional] 
**body_template** | **str** |  | [optional] 
**wait_for_response** | **bool** |  | [optional] [default to False]
**timeout_ms** | **int** |  | [optional] [default to 30000]
**response_as** | **str** |  | [optional] 

## Example

```python
from omni_generated.models.list_automations200_response_items_inner_actions_inner_any_of_config import ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig

# TODO update the JSON string below
json = "{}"
# create an instance of ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig from a JSON string
list_automations200_response_items_inner_actions_inner_any_of_config_instance = ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig.from_json(json)
# print the JSON string representation of the object
print(ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig.to_json())

# convert the object into a dict
list_automations200_response_items_inner_actions_inner_any_of_config_dict = list_automations200_response_items_inner_actions_inner_any_of_config_instance.to_dict()
# create an instance of ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig from a dict
list_automations200_response_items_inner_actions_inner_any_of_config_from_dict = ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig.from_dict(list_automations200_response_items_inner_actions_inner_any_of_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


