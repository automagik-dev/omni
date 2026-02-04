# GetRecentLogs200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[GetRecentLogs200ResponseItemsInner]**](GetRecentLogs200ResponseItemsInner.md) |  | 
**meta** | [**GetRecentLogs200ResponseMeta**](GetRecentLogs200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.get_recent_logs200_response import GetRecentLogs200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetRecentLogs200Response from a JSON string
get_recent_logs200_response_instance = GetRecentLogs200Response.from_json(json)
# print the JSON string representation of the object
print(GetRecentLogs200Response.to_json())

# convert the object into a dict
get_recent_logs200_response_dict = get_recent_logs200_response_instance.to_dict()
# create an instance of GetRecentLogs200Response from a dict
get_recent_logs200_response_from_dict = GetRecentLogs200Response.from_dict(get_recent_logs200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


