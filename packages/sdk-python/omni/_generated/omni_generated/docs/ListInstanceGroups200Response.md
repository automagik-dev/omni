# ListInstanceGroups200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListInstanceGroups200ResponseItemsInner]**](ListInstanceGroups200ResponseItemsInner.md) |  | 
**meta** | [**ListInstanceContacts200ResponseMeta**](ListInstanceContacts200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.list_instance_groups200_response import ListInstanceGroups200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListInstanceGroups200Response from a JSON string
list_instance_groups200_response_instance = ListInstanceGroups200Response.from_json(json)
# print the JSON string representation of the object
print(ListInstanceGroups200Response.to_json())

# convert the object into a dict
list_instance_groups200_response_dict = list_instance_groups200_response_instance.to_dict()
# create an instance of ListInstanceGroups200Response from a dict
list_instance_groups200_response_from_dict = ListInstanceGroups200Response.from_dict(list_instance_groups200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


