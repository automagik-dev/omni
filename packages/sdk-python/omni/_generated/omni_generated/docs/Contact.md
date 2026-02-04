# Contact


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
from omni_generated.models.contact import Contact

# TODO update the JSON string below
json = "{}"
# create an instance of Contact from a JSON string
contact_instance = Contact.from_json(json)
# print the JSON string representation of the object
print(Contact.to_json())

# convert the object into a dict
contact_dict = contact_instance.to_dict()
# create an instance of Contact from a dict
contact_from_dict = Contact.from_dict(contact_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


