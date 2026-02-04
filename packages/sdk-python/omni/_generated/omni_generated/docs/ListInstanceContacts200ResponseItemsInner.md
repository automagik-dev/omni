# ListInstanceContacts200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**platform_user_id** | **str** | Platform user ID | 
**display_name** | **str** | Display name | [optional] 
**phone** | **str** | Phone number | [optional] 
**avatar_url** | **str** | Avatar URL | [optional] 
**is_group** | **bool** | Whether this is a group | 
**is_business** | **bool** | Whether this is a business account | [optional] 
**platform_metadata** | **Dict[str, Optional[object]]** | Platform-specific metadata | [optional] 

## Example

```python
from omni_generated.models.list_instance_contacts200_response_items_inner import ListInstanceContacts200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListInstanceContacts200ResponseItemsInner from a JSON string
list_instance_contacts200_response_items_inner_instance = ListInstanceContacts200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListInstanceContacts200ResponseItemsInner.to_json())

# convert the object into a dict
list_instance_contacts200_response_items_inner_dict = list_instance_contacts200_response_items_inner_instance.to_dict()
# create an instance of ListInstanceContacts200ResponseItemsInner from a dict
list_instance_contacts200_response_items_inner_from_dict = ListInstanceContacts200ResponseItemsInner.from_dict(list_instance_contacts200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


