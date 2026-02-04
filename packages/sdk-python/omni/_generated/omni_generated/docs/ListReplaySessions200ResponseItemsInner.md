# ListReplaySessions200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Session UUID | 
**status** | **str** | Status | 
**options** | [**ListReplaySessions200ResponseItemsInnerOptions**](ListReplaySessions200ResponseItemsInnerOptions.md) |  | 
**progress** | [**ListReplaySessions200ResponseItemsInnerProgress**](ListReplaySessions200ResponseItemsInnerProgress.md) |  | 

## Example

```python
from omni_generated.models.list_replay_sessions200_response_items_inner import ListReplaySessions200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListReplaySessions200ResponseItemsInner from a JSON string
list_replay_sessions200_response_items_inner_instance = ListReplaySessions200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListReplaySessions200ResponseItemsInner.to_json())

# convert the object into a dict
list_replay_sessions200_response_items_inner_dict = list_replay_sessions200_response_items_inner_instance.to_dict()
# create an instance of ListReplaySessions200ResponseItemsInner from a dict
list_replay_sessions200_response_items_inner_from_dict = ListReplaySessions200ResponseItemsInner.from_dict(list_replay_sessions200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


