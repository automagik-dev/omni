# ListInstanceContacts200ResponseMeta


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_fetched** | **float** |  | 
**has_more** | **bool** |  | 
**cursor** | **str** |  | [optional] 

## Example

```python
from omni_generated.models.list_instance_contacts200_response_meta import ListInstanceContacts200ResponseMeta

# TODO update the JSON string below
json = "{}"
# create an instance of ListInstanceContacts200ResponseMeta from a JSON string
list_instance_contacts200_response_meta_instance = ListInstanceContacts200ResponseMeta.from_json(json)
# print the JSON string representation of the object
print(ListInstanceContacts200ResponseMeta.to_json())

# convert the object into a dict
list_instance_contacts200_response_meta_dict = list_instance_contacts200_response_meta_instance.to_dict()
# create an instance of ListInstanceContacts200ResponseMeta from a dict
list_instance_contacts200_response_meta_from_dict = ListInstanceContacts200ResponseMeta.from_dict(list_instance_contacts200_response_meta_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


