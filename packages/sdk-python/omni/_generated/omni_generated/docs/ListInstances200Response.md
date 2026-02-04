# ListInstances200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListInstances200ResponseItemsInner]**](ListInstances200ResponseItemsInner.md) |  | 
**meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.list_instances200_response import ListInstances200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListInstances200Response from a JSON string
list_instances200_response_instance = ListInstances200Response.from_json(json)
# print the JSON string representation of the object
print(ListInstances200Response.to_json())

# convert the object into a dict
list_instances200_response_dict = list_instances200_response_instance.to_dict()
# create an instance of ListInstances200Response from a dict
list_instances200_response_from_dict = ListInstances200Response.from_dict(list_instances200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


