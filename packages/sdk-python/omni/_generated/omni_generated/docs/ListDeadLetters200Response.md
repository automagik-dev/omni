# ListDeadLetters200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListDeadLetters200ResponseItemsInner]**](ListDeadLetters200ResponseItemsInner.md) |  | 
**meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.list_dead_letters200_response import ListDeadLetters200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListDeadLetters200Response from a JSON string
list_dead_letters200_response_instance = ListDeadLetters200Response.from_json(json)
# print the JSON string representation of the object
print(ListDeadLetters200Response.to_json())

# convert the object into a dict
list_dead_letters200_response_dict = list_dead_letters200_response_instance.to_dict()
# create an instance of ListDeadLetters200Response from a dict
list_dead_letters200_response_from_dict = ListDeadLetters200Response.from_dict(list_dead_letters200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


