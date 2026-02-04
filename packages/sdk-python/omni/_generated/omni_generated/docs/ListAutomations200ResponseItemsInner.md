# ListAutomations200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Automation UUID | 
**name** | **str** | Name | 
**description** | **str** | Description | 
**trigger_event_type** | **str** | Trigger event type | 
**trigger_conditions** | [**List[ListAutomations200ResponseItemsInnerTriggerConditionsInner]**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) | Conditions | 
**condition_logic** | **str** | Condition logic | 
**actions** | [**List[ListAutomations200ResponseItemsInnerActionsInner]**](ListAutomations200ResponseItemsInnerActionsInner.md) | Actions | 
**debounce** | [**ListAutomations200ResponseItemsInnerDebounce**](ListAutomations200ResponseItemsInnerDebounce.md) |  | 
**enabled** | **bool** | Whether enabled | 
**priority** | **int** | Priority | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.list_automations200_response_items_inner import ListAutomations200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListAutomations200ResponseItemsInner from a JSON string
list_automations200_response_items_inner_instance = ListAutomations200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListAutomations200ResponseItemsInner.to_json())

# convert the object into a dict
list_automations200_response_items_inner_dict = list_automations200_response_items_inner_instance.to_dict()
# create an instance of ListAutomations200ResponseItemsInner from a dict
list_automations200_response_items_inner_from_dict = ListAutomations200ResponseItemsInner.from_dict(list_automations200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


