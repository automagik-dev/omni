# ListAutomations200ResponseItemsInnerDebounce

Debounce config

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**mode** | **str** |  | 
**delay_ms** | **int** |  | [optional] 
**min_ms** | **int** |  | [optional] 
**max_ms** | **int** |  | [optional] 
**base_delay_ms** | **int** |  | [optional] 
**max_wait_ms** | **int** |  | [optional] 
**extend_on_events** | **List[str]** |  | [optional] 

## Example

```python
from omni_generated.models.list_automations200_response_items_inner_debounce import ListAutomations200ResponseItemsInnerDebounce

# TODO update the JSON string below
json = "{}"
# create an instance of ListAutomations200ResponseItemsInnerDebounce from a JSON string
list_automations200_response_items_inner_debounce_instance = ListAutomations200ResponseItemsInnerDebounce.from_json(json)
# print the JSON string representation of the object
print(ListAutomations200ResponseItemsInnerDebounce.to_json())

# convert the object into a dict
list_automations200_response_items_inner_debounce_dict = list_automations200_response_items_inner_debounce_instance.to_dict()
# create an instance of ListAutomations200ResponseItemsInnerDebounce from a dict
list_automations200_response_items_inner_debounce_from_dict = ListAutomations200ResponseItemsInnerDebounce.from_dict(list_automations200_response_items_inner_debounce_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


