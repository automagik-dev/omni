# GetRecentLogs200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**time** | **float** | Timestamp (ms) | 
**level** | **str** | Log level | 
**module** | **str** | Module name | 
**msg** | **str** | Log message | 

## Example

```python
from omni_generated.models.get_recent_logs200_response_items_inner import GetRecentLogs200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of GetRecentLogs200ResponseItemsInner from a JSON string
get_recent_logs200_response_items_inner_instance = GetRecentLogs200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(GetRecentLogs200ResponseItemsInner.to_json())

# convert the object into a dict
get_recent_logs200_response_items_inner_dict = get_recent_logs200_response_items_inner_instance.to_dict()
# create an instance of GetRecentLogs200ResponseItemsInner from a dict
get_recent_logs200_response_items_inner_from_dict = GetRecentLogs200ResponseItemsInner.from_dict(get_recent_logs200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


