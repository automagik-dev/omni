# ListInstanceContacts200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListInstanceContacts200ResponseItemsInner]**](ListInstanceContacts200ResponseItemsInner.md) |  | 
**meta** | [**ListInstanceContacts200ResponseMeta**](ListInstanceContacts200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.list_instance_contacts200_response import ListInstanceContacts200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListInstanceContacts200Response from a JSON string
list_instance_contacts200_response_instance = ListInstanceContacts200Response.from_json(json)
# print the JSON string representation of the object
print(ListInstanceContacts200Response.to_json())

# convert the object into a dict
list_instance_contacts200_response_dict = list_instance_contacts200_response_instance.to_dict()
# create an instance of ListInstanceContacts200Response from a dict
list_instance_contacts200_response_from_dict = ListInstanceContacts200Response.from_dict(list_instance_contacts200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


