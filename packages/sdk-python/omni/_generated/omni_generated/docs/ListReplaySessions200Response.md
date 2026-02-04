# ListReplaySessions200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListReplaySessions200ResponseItemsInner]**](ListReplaySessions200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.list_replay_sessions200_response import ListReplaySessions200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListReplaySessions200Response from a JSON string
list_replay_sessions200_response_instance = ListReplaySessions200Response.from_json(json)
# print the JSON string representation of the object
print(ListReplaySessions200Response.to_json())

# convert the object into a dict
list_replay_sessions200_response_dict = list_replay_sessions200_response_instance.to_dict()
# create an instance of ListReplaySessions200Response from a dict
list_replay_sessions200_response_from_dict = ListReplaySessions200Response.from_dict(list_replay_sessions200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


