# SendContactRequestContact


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Contact name | 
**phone** | **str** | Phone number | [optional] 
**email** | **str** | Email address | [optional] 
**organization** | **str** | Organization | [optional] 

## Example

```python
from omni_generated.models.send_contact_request_contact import SendContactRequestContact

# TODO update the JSON string below
json = "{}"
# create an instance of SendContactRequestContact from a JSON string
send_contact_request_contact_instance = SendContactRequestContact.from_json(json)
# print the JSON string representation of the object
print(SendContactRequestContact.to_json())

# convert the object into a dict
send_contact_request_contact_dict = send_contact_request_contact_instance.to_dict()
# create an instance of SendContactRequestContact from a dict
send_contact_request_contact_from_dict = SendContactRequestContact.from_dict(send_contact_request_contact_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


